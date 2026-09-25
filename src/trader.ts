import { config } from "./config";
import { bpsBetween, snapshotIndicators, venueFeatures } from "./indicators";
import type { Market } from "./market";
import type { Model, ModelDecision, TradeState } from "./model";
import { planFromRisk, planQuote, type QuotePlan } from "./plan";
import { toSnapshot, toState } from "./risk/buckets";
import { isFrozen, riskIntent, standsDown } from "./risk/intent";
import type { Policy, PolicyCtx, Snapshot, StanceRaw, Verdict } from "./risk/types";
import { SIGMA, lastClosedH1 } from "./policy/sigma";
import { stanceFeatures, type StanceBar } from "./policy/stance_features";
import { cycleId, type Ledger } from "./ledger/jsonl";
import { aggregateFills, emptySummary, takeLiveFills, takeSimFills, type Resting, type TradeFeed } from "./trades";
import type { BlockEvent, Book, Fill, PricePoint, Quote, Side, Timing, Totals } from "./types";

const emptyTotals = (): Totals => ({
  blocks: 0, decisions: 0, quotes: 0, fills: 0, reverted: 0, lateBlocks: 0,
  jevUsd: 0, gasSz: 0, gasUsd: 0, realizedUsd: 0, pnlUsd: 0, pnlSz: 0, pnlPct: 0,
});

const JEV_PAUSE_MS = 30_000;

export function jevUnavailable(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /402\b|no available TypeSafe API credits|insufficient credits/i.test(msg);
}

/**
 * Every tick: read the book and ask the model. A tick is late only when Jev
 * is still answering. Hyperliquid leverage/order I/O runs in the background
 * so a fill or quote does not stall the next decision.
 */
/** O que o caminho da fusao precisa da POLICY e do LEDGER (spec 1). */
export interface Fusion {
  policy: Policy;
  ledger: Ledger;
}

/**
 * O que o `emit` precisa de uma decisao, comum aos dois caminhos: o legado manda
 * um `ModelDecision` inteiro, a fusao manda o `act` e o `bias` fica de fora —
 * no caminho da fusao o lado vive em `act`.
 */
type Decidable = Pick<ModelDecision, "action" | "probabilities" | "upIn10" | "latencyMs"> &
  Partial<Pick<ModelDecision, "intent" | "bias" | "leverage" | "inputTokens" | "state12" | "act" | "act_conf" | "too_hostile" | "reason">>;

export class Trader {
  readonly history: BlockEvent[] = [];
  private mids: number[] = [];
  private busy = false;
  private lastBook: Book | null = null;
  private trades: TradeFeed | null = null;
  private orders = new Map<number, Resting>();
  private simId = 0;
  private sendSeq = 0;
  private exchangeTail: Promise<void> = Promise.resolve();
  private position = { sz: 0, costUsd: 0 };
  private totals: Totals = emptyTotals();
  private jevPauseUntil = 0;
  private stancePrev = new Map<string, StanceRaw>();
  /** F4 — a H1 fechada que ja foi decidida, por moeda. O portao do relogio le e escreve aqui. */
  private h1Decided = new Map<string, number>();

  constructor(
    private market: Market,
    private model: Model,
    private onEvent: (e: BlockEvent, timing?: Timing) => void,
    private onFill: (block: number, fill: Fill) => void = () => {},
    private onQuote: (block: number, quote: Quote) => void = () => {},
    /** Presente so quando `POLICY` esta definido. Ausente, o tick e o de sempre. */
    private fusion: Fusion | null = null,
  ) {}

  get tape(): PricePoint[] {
    return this.market.chartPoints;
  }

  attachTradeFeed(feed: TradeFeed) {
    this.trades = feed;
  }

  async onBlock(block: number) {
    this.totals.blocks++;
    if (this.totals.blocks % 5 === 0) this.market.refresh().catch(() => {});
    if (this.busy) {
      this.markLate(block, this.lastBook);
      return;
    }
    this.busy = true;
    const t0 = performance.now();
    try {
      const book = this.market.readBook();
      const readMs = performance.now() - t0;
      this.lastBook = book;
      this.mids.push(book.mid);
      if (this.mids.length > 400) this.mids.shift();
      this.harvest();

      this.syncFromVenue();
      const timing = { readMs: Math.round(readMs), loopMs: 0 };
      if (Date.now() < this.jevPauseUntil) {
        this.markLate(block, book);
        return;
      }
      try {
        if (this.fusion) {
          await this.fusedTick(block, book, timing, t0, this.fusion);
        } else {
          const decision = await this.model.decide(this.buildState(block, book));
          this.totals.decisions++;
          this.totals.jevUsd += (decision.inputTokens / 1e6) * config.jevUsdPerMTok;
          const plan = planQuote({
            intent: decision.intent,
            bias: decision.bias,
            positionSz: this.position.sz,
            quoteSz: this.market.quoteSize(book.mid),
          });
          timing.loopMs = Math.round(performance.now() - t0);
          this.emit(block, book, decision, null, false, timing);
          if (plan) this.enqueueQuote(block, plan, book, decision.leverage);
          else this.enqueueStandDown();
        }
      } catch (e) {
        const msg = (e as Error).message;
        if (jevUnavailable(e)) {
          this.jevPauseUntil = Date.now() + JEV_PAUSE_MS;
          console.error(`jev paused ${JEV_PAUSE_MS / 1000}s: ${msg}`);
        } else {
          console.error(`tick ${block}:`, msg);
        }
        this.markLate(block, book, timing);
      }
    } catch (e) {
      console.error(`tick ${block}:`, (e as Error).message);
    } finally {
      this.busy = false;
    }
  }

  /**
   * `leverage` entra por parametro: o caminho da fusao passa `config.leverage`
   * (o modelo nao escolhe alavancagem na v1) e o caminho legado continua a passar
   * o que o modelo decidiu. A assinatura do `setLeverage` do venue nao muda.
   */
  private enqueueQuote(block: number, plan: QuotePlan, book: Book, leverage: number) {
    const seq = ++this.sendSeq;
    this.exchangeTail = this.exchangeTail.catch(() => {}).then(async () => {
      if (seq !== this.sendSeq) return;
      // An exit skips the leverage write: nothing about it depends on margin, and
      // the extra round trip is pure delay on the one order that has to land now.
      if (!plan.taker) {
        await this.market.setLeverage(leverage);
        if (seq !== this.sendSeq) return;
      }
      const cancel = [...this.orders.keys()].filter((id) => id > 0);
      const quote = await this.market.send(plan.side, plan.size, book, cancel, plan.reduceOnly, plan.taker);
      if (seq !== this.sendSeq) return;
      this.applyPosted(block, quote);
    });
  }

  /** Jev held. Pull the standing quote so an order it no longer wants cannot get hit. */
  private enqueueStandDown() {
    const seq = ++this.sendSeq;
    this.exchangeTail = this.exchangeTail.catch(() => {}).then(async () => {
      if (seq !== this.sendSeq) return;
      await this.market.cancelResting();
      if (seq !== this.sendSeq) return;
      this.orders.clear();
    });
  }

  /**
   * O tick da fusao (spec 8): snapshot -> state -> POLICY -> RISK -> planFromRisk
   * e depois o **mesmo** `enqueueQuote` -> `market.send`. Nada aqui abre uma
   * segunda via de ordem.
   */
  private async fusedTick(block: number, book: Book, timing: Timing, t0: number, fusion: Fusion) {
    const now = Date.now();
    const snap = this.buildSnapshot(now, book);
    const state = toState(snap);
    const cid = cycleId(new Date(now), this.market.coin);
    const ctx = this.policyCtx(snap, now);
    // F4 — portao do relogio. O `s` e H1 mas o tick corre em todo o bloco: sem isto, o 5m
    // re-cotiza. So uma H1 **fechada nova** abre decisao de inventario; no resto do tempo o
    // tick e um `hold` que nao chama a policy, nao flipa e nao desmonta a resting que serve.
    const verdict = this.repeatH1(ctx, now)
      ? this.gateHold(cid)
      : await fusion.policy.decide(state, cid, ctx);
    if (verdict.raw) this.stancePrev.set(this.market.coin, verdict.raw);
    this.totals.decisions++;
    this.totals.jevUsd += ((verdict.input_tokens ?? 0) / 1e6) * config.jevUsdPerMTok;
    const intent = riskIntent({ cycleId: cid, sleeve: this.market.coin, verdict, snap });
    const frozen = isFrozen(intent);
    const plan = planFromRisk(intent, this.position.sz, this.market.quoteSize(book.mid));
    timing.loopMs = Math.round(performance.now() - t0);
    if (frozen) this.totals.lateBlocks++;
    this.emit(block, book, fusedDecision(verdict, state, intent.reason), null, frozen, timing);
    fusion.ledger.writeDecision({
      kind: "decision",
      cycle_id: cid,
      ts: now,
      sleeve: this.market.coin,
      state,
      returns_bps: snap.returns_bps,
      mid_5m: ctx.mid_5m,
      u: ctx.u,
      s: ctx.s,
      ema_h1: ctx.ema_h1,
      raw: verdict.raw,
      signal: verdict.signal,
      wick_veto: verdict.wick_veto,
      cb_active: verdict.cb_active,
      cb_flips_12h: verdict.cb_flips_12h,
      cb_until: verdict.cb_until,
      verdict,
      intent,
      // O fill chega assincrono (userFills/dry-run): a linha do fill e escrita
      // quando ele existe, com o mesmo cycle_id. Ver a nota do PR.
      fill: null,
    });
    if (plan) this.enqueueQuote(block, plan, book, config.leverage);
    else if (standsDown(intent)) this.enqueueStandDown();
    // Congelado (timeout/JSON invalido/livro velho): sem ordem nova **e** sem
    // cancelar. Nao ha mais nada a fazer neste tick — e a decisao D3.
  }

  /**
   * F4 — o portao do relogio: `true` quando NAO ha H1 fechada nova (o tick fica em `hold`).
   *
   * A unidade e a vela H1 **fechada**, pelo mesmo critério do sigma: o instante de fecho
   * (`t + 1h`) e comparado com o da ultima decidida. Doze blocos dentro da mesma hora — 12
   * velas de 5m — sao doze `hold`, sem ordem nova. Uma vela nova marca e devolve `false`, e a
   * decisao corre como sempre (s + veto + CB).
   *
   * Vale **so** para `POLICY=sigma`: `jev`, `dumb`, `numeric` e `stance` mantem o relogio deles
   * — esta fatia nao lhes muda o comportamento. O tick de 5m continua a ingerir barra no chart.
   */
  private repeatH1(ctx: PolicyCtx, now: number): boolean {
    if (config.policy !== "sigma") return false;
    const bars = ctx.h1 ?? [];
    const idx = lastClosedH1(bars, now);
    if (idx < 0) return true; // ainda nao fechou nenhuma H1: nada de inventario
    const closeAt = bars[idx]!.t + 3_600_000;
    if (this.h1Decided.get(this.market.coin) === closeAt) return true;
    this.h1Decided.set(this.market.coin, closeAt);
    return false;
  }

  /**
   * A decisao do portao: `hold` com a postura vigente, sem chamar a policy. O `raw` mantem-se e
   * o `signal` e `hold`, e por isso o `riskIntent` da-lhe a razao `stance_hold` — a resting que
   * ja serve nao e cancelada. Sem postura anterior (`caixa`), nada fica a caminho.
   */
  private gateHold(cid: string): Verdict {
    const prev = this.stancePrev.get(this.market.coin);
    return {
      cycle_id: cid,
      model: config.policy,
      latency_ms: 0,
      act: "hold",
      act_probs: { buy: 0.25, sell: 0.25, hold: 0.5 },
      act_conf: SIGMA.CONF_ON_HOLD,
      too_hostile: SIGMA.HOSTILE_FALSE,
      raw_ok: true,
      raw: prev === "buy" || prev === "sell" ? prev : "caixa",
      signal: "hold",
      wick_veto: false,
      note: "sigma: sem H1 fechada nova (portao do relogio)",
    };
  }

  private policyCtx(snap: Snapshot, now: number): PolicyCtx {
    const ctx: PolicyCtx = {
      returns_bps: snap.returns_bps,
      raw_prev: this.stancePrev.get(this.market.coin),
    };
    const m = this.market as Market & {
      candleBars5m?: () => { ts: number; high: number; low: number; close: number }[];
      candleBars1h?: () => { ts: number; high: number; low: number; close: number }[];
    };
    const raw5 = m.candleBars5m?.() ?? [];
    const raw1h = m.candleBars1h?.() ?? [];
    const toBar = (c: { ts: number; high: number; low: number }): StanceBar => ({
      t: c.ts,
      high: c.high,
      low: c.low,
      mid: (c.high + c.low) / 2,
    });
    const feat = stanceFeatures(raw5.map(toBar), raw1h.map(toBar), now);
    if (feat) {
      ctx.mid_5m = feat.mid_5m;
      ctx.u = feat.u;
      ctx.s = feat.s;
      ctx.ema_h1 = feat.ema_h1;
    }
    // Sigma: as velas H1 cruas COM o close. E o sigma que escolhe a ultima fechada, pelo
    // instante do ciclo — o tick de 5m ingere barra, nao vira inventario.
    ctx.h1 = raw1h.map((c) => ({ t: c.ts, high: c.high, low: c.low, close: c.close }));
    return ctx;
  }

  /**
   * O snapshot da fusao. Le os mesmos indicadores do `buildState` legado; a
   * duplicacao e deliberada para o caminho legado nao mudar de comportamento.
   */
  private buildSnapshot(ts: number, book: Book): Snapshot {
    const m = this.mids, n = m.length, H = config.horizonBlocks;
    const ret = (k: number) => (n > k ? ((m[n - 1]! - m[n - 1 - k]!) / m[n - 1 - k]!) * 10_000 : 0);
    const a = this.market.account;
    const indicators = snapshotIndicators(this.market.candleCloses(80), book.mid);
    const features = venueFeatures(this.market.assetCtx, book.mid);
    const posSz = this.position.sz;
    const summary = this.trades ? this.trades.summary(H, book.block) : emptySummary();
    const bookAt = this.market.bookAt;
    return toSnapshot({
      ts,
      sleeve: this.market.coin,
      book: { bid: book.bid, ask: book.ask, mid: book.mid, spreadBps: book.spreadBps, depthBps: book.depthBps },
      bookAgeMs: bookAt == null ? Number.POSITIVE_INFINITY : Math.max(0, ts - bookAt),
      returnsBps: { last1: ret(1), last5: ret(5), last20: ret(20) },
      volBps: indicators.vol20Bps ?? null,
      prints: summary,
      position: { side: posSz > 0 ? "long" : posSz < 0 ? "short" : "flat", size: posSz },
      account: a ? { equityUsd: a.accountValue, unrealizedUsd: a.unrealizedUsd, leverage: a.leverage } : null,
      fundingBps: features.fundingBps,
      mark: this.market.assetCtx?.markPx ?? null,
      bankrollUsd: config.bankrollUsd,
      maxLeverage: this.market.maxLeverage,
    });
  }

  private markLate(block: number, book: Book | null, timing?: Timing) {
    this.totals.lateBlocks++;
    if (book) this.emit(block, book, null, null, true, timing);
  }

  private applyPosted(block: number, quote: Quote) {
    const e = this.history.find((h) => h.block === block);
    if (e) e.quote = quote;
    if (!quote.unchanged) this.totals.quotes++;
    if (quote.status === "reverted") this.totals.reverted++;
    if (quote.taker) {
      // An Ioc never rests. Live fills arrive on userFills; a dry run fills here.
      this.orders.clear();
      if (quote.status === "sim") this.simTakerFill(block, quote);
    } else if (quote.status === "sim") {
      this.orders.clear();
      this.orders.set(--this.simId, { side: quote.side, price: quote.price, size: quote.size, block });
    } else if (quote.status === "placed" && quote.orderId != null) {
      this.orders.clear();
      this.orders.set(quote.orderId, { side: quote.side, price: quote.price, size: quote.size, block });
    }
    this.onQuote(block, quote);
  }

  /** A dry-run exit crosses the touch, so it fills now rather than waiting on a print. */
  private simTakerFill(block: number, quote: Quote) {
    const fill: Fill = {
      side: quote.side,
      size: quote.size,
      price: quote.price,
      txHash: null,
      orderId: --this.simId,
      simulated: true,
      dir: quote.reduceOnly ? "close" : "open",
    };
    this.applyFill(fill);
    this.recordFill(block, fill);
  }

  private harvest() {
    if (!this.trades) return;
    const prints = this.trades.drainPrints();
    const fills = this.market.wallet ? takeLiveFills(this.orders, this.trades.drainFills()) : takeSimFills(this.orders, prints);
    if (!fills.length) return;
    const byBlock = new Map<number, Fill[]>();
    for (const f of fills) {
      this.applyFill(f);
      byBlock.set(f.block, [...(byBlock.get(f.block) ?? []), f]);
    }
    for (const [block, fs] of byBlock) this.recordFill(block, aggregateFills(fs));
    this.market.refresh().catch(() => {});
  }

  private recordFill(block: number, fill: Fill) {
    const e = this.history.find((h) => h.block === block);
    if (e) e.fill = fill;
    this.onFill(block, fill);
  }

  private restingSz(side: Side) {
    let sz = 0;
    for (const o of this.orders.values()) if (o.side === side) sz += o.size;
    return sz;
  }

  private buildState(block: number, book: Book): TradeState {
    this.syncFromVenue();
    const m = this.mids, n = m.length, H = config.horizonBlocks;
    const ret = (k: number) => (n > k ? ((m[n - 1]! - m[n - 1 - k]!) / m[n - 1 - k]!) * 10_000 : 0);
    const sampled = m.slice(-H).filter((_, i, a) => (a.length - 1 - i) % 5 === 0);
    const lvl = (l: [number, number]) => `${l[0].toFixed(6)} x ${round(l[1], 1)}`;
    const depth: TradeState["depth"] = {};
    for (const [k, v] of Object.entries(book.depthBps)) depth[k + "bps"] = { bid: round(v.bid, 1), ask: round(v.ask, 1) };
    const posSz = this.position.sz;
    const a = this.market.account;
    const entry = this.entryPrice();
    const unrealized = a ? a.unrealizedUsd : this.unrealizedUsd(book.mid);
    const indicators = snapNums(snapshotIndicators(this.market.candleCloses(80), book.mid));
    const asset = snapNums(venueFeatures(this.market.assetCtx, book.mid));
    return {
      coin: this.market.coin,
      market: this.market.pair,
      tick: block,
      tickMs: config.tickMs,
      mid: book.mid,
      spreadBps: round(book.spreadBps, 2),
      bookImbalance: round(book.imbalance, 3),
      depth,
      book: { bids: book.levels.bids.map(lvl), asks: book.levels.asks.map(lvl) },
      returnsBps: { last1: round(ret(1), 2), last5: round(ret(5), 2), last20: round(ret(20), 2), last100: round(ret(100), 2) },
      recentMids: sampled.map((x) => x.toFixed(6)).join(" "),
      trades: this.trades ? this.trades.summary(H, block) : emptySummary(),
      recentTrades: (this.trades?.recent(10) ?? []).map((t) => `${t.block} ${t.side} ${round(t.size, 1)} @ ${t.price.toFixed(6)}`),
      position: {
        coin: this.market.coin,
        side: posSz > 0 ? "long" : posSz < 0 ? "short" : "flat",
        size: round(Math.abs(posSz), 8),
        notionalUsd: round(Math.abs(posSz) * book.mid, 4),
        entry,
        leverage: a?.leverage ?? null,
        liquidationPx: a?.liquidationPx ?? null,
        distanceBps: rnull(bpsBetween(entry, book.mid), 2),
        unrealizedUsd: round(unrealized, 4),
      },
      indicators,
      asset: { ...asset, maxLeverage: this.market.maxLeverage },
      maxLeverage: this.market.maxLeverage,
    };
  }

  private applyFill(f: Fill) {
    if (f.size <= 0) return;
    if (this.market.account) return;
    this.totals.fills++;
    const signed = f.side === "buy" ? f.size : -f.size;
    const p = this.position;
    if (p.sz === 0 || Math.sign(p.sz) === Math.sign(signed)) {
      p.costUsd += signed * f.price;
    } else {
      const closing = Math.min(Math.abs(signed), Math.abs(p.sz)) * Math.sign(signed);
      const entry = p.costUsd / p.sz;
      this.totals.realizedUsd += -closing * (f.price - entry);
      p.costUsd += closing * entry;
      const remainder = signed - closing;
      p.costUsd += remainder * f.price;
    }
    p.sz += signed;
    if (Math.abs(p.sz) < 1e-9) { p.sz = 0; p.costUsd = 0; }
    if (f.feeUsd) this.totals.gasUsd += f.feeUsd;
  }

  private syncFromVenue() {
    const a = this.market.account;
    if (!a) return;
    this.position.sz = a.positionSz;
    this.position.costUsd = a.entryPrice != null && a.positionSz ? a.entryPrice * a.positionSz : 0;
    this.totals.realizedUsd = a.realizedUsd;
    this.totals.gasUsd = a.feesUsd;
    this.totals.fills = this.market.fillPrints.length;
  }

  private entryPrice() { return this.position.sz ? this.position.costUsd / this.position.sz : null; }
  private unrealizedUsd(mid: number) { return this.position.sz ? this.position.sz * (mid - this.entryPrice()!) : 0; }

  private emit(block: number, book: Book, decision: Decidable | null, quote: Quote | null, late: boolean, timing?: Timing) {
    this.syncFromVenue();
    const t = this.totals;
    t.gasSz = book.mid ? t.gasUsd / book.mid : 0;
    const a = this.market.account;
    const unrealized = a ? a.unrealizedUsd : this.unrealizedUsd(book.mid);
    t.pnlUsd = t.realizedUsd + unrealized - t.gasUsd;
    t.pnlSz = t.pnlUsd / book.mid;
    t.pnlPct = (t.pnlUsd / (a?.accountValue || config.bankrollUsd)) * 100;
    const size = Math.abs(this.position.sz);
    const event: BlockEvent = {
      coin: this.market.coin,
      block, ts: Date.now(), mid: book.mid, bestBid: book.bid, bestAsk: book.ask, spreadBps: round(book.spreadBps, 2),
      decision: late
        ? {
          // Um bloco congelado continua a mostrar o que o Jev respondeu, marcado late.
          action: decision?.action ?? "hold",
          probabilities: decision?.probabilities ?? { buy: 0, sell: 0, hold: 1 },
          upIn10: decision?.upIn10 ?? 0.5,
          latencyMs: decision ? Math.round(decision.latencyMs) : 0,
          late: true,
          state12: decision?.state12,
          act: decision?.act,
          act_conf: decision?.act_conf,
          too_hostile: decision?.too_hostile,
          reason: decision?.reason,
        }
        : decision && {
          action: decision.action,
          intent: decision.intent,
          bias: decision.bias,
          leverage: decision.leverage,
          probabilities: decision.probabilities,
          upIn10: decision.upIn10,
          latencyMs: Math.round(decision.latencyMs),
          late: false,
          state12: decision.state12,
          act: decision.act,
          act_conf: decision.act_conf,
          too_hostile: decision.too_hostile,
          reason: decision.reason,
        },
      quote,
      fill: null,
      resting: { bidSz: round(this.restingSz("buy"), this.market.szDecimals), askSz: round(this.restingSz("sell"), this.market.szDecimals) },
      position: {
        side: this.position.sz > 0 ? "long" : this.position.sz < 0 ? "short" : "flat",
        size,
        entryPrice: this.entryPrice(),
        leverage: a?.leverage ?? decision?.leverage ?? null,
        unrealizedUsd: round(unrealized, 6),
        unrealizedSz: round(unrealized / book.mid, 8),
      },
      totals: { ...t, jevUsd: round(t.jevUsd, 6), gasSz: round(t.gasSz, 8), gasUsd: round(t.gasUsd, 6), realizedUsd: round(t.realizedUsd, 6), pnlUsd: round(t.pnlUsd, 6), pnlSz: round(t.pnlSz, 8), pnlPct: round(t.pnlPct, 4) },
      accountValue: a && Number.isFinite(a.accountValue) ? round(a.accountValue, 2) : null,
      withdrawable: a && Number.isFinite(a.withdrawable) ? round(a.withdrawable, 2) : null,
    };
    this.history.push(event);
    if (this.history.length > config.historySize) this.history.shift();
    this.onEvent(event, timing);
  }
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
const rnull = (x: number | null, d: number) => (x == null || !Number.isFinite(x) ? null : round(x, d));

/** O `ModelDecision` do mundo da fusao: alimenta o desk e a linha do ledger. */
function fusedDecision(v: Verdict, state: string, reason?: string): Decidable {
  return {
    action: v.act,
    leverage: config.leverage,
    probabilities: {
      buy: v.act_probs.buy,
      sell: v.act_probs.sell,
      hold: v.act_probs.hold,
      long: 0,
      short: 0,
      open: 0,
      close: 0,
    },
    upIn10: v.act_probs.buy,
    latencyMs: v.latency_ms,
    inputTokens: v.input_tokens ?? 0,
    state12: state,
    act: v.act,
    act_conf: v.act_conf,
    too_hostile: v.too_hostile,
    reason,
  };
}

function snapNums<T extends Record<string, number | null>>(obj: T): T {
  const out = { ...obj };
  for (const [k, v] of Object.entries(out)) {
    (out as Record<string, number | null>)[k] = typeof v === "number" ? round(v, 6) : v;
  }
  return out;
}
