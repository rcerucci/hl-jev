/**
 * A caixa RISK, primeira metade: numeros do venue -> linhas curtas de adjectivos.
 *
 * Todo o corte vive aqui, com constante nomeada. Nenhum outro ficheiro decide
 * limiar (spec 3.2: "um unico ficheiro, sem magia espalhada").
 */
import { config } from "../config";
import type { Snapshot } from "./types";

/** Banda de spread em bps. */
export const SPREAD = { TIGHT_BPS: 2, NORMAL_BPS: 6, WIDE_BPS: 15 } as const;
/** Livro em USD dentro de 10 bps do mid. */
export const DEPTH_USD = { THIN: 2_000, DEEP: 20_000 } as const;
/** Impressoes na janela do tick e desequilibrio de agressao. */
export const FLOW = { QUIET_PRINTS: 8, BOT_WAR_PRINTS: 60, ONE_SIDED: 0.25 } as const;
/** Movimento em bps em **20 ticks** (`last20`; com `TICK_MS=2000` sao ~40 s) e volatilidade realizada. */
export const TAPE = { GRIND_BPS: 4, MOVE_BPS: 15, VIOLENT_BPS: 40 } as const;
/** |notional| / referencia de capital: perto de zero e plano, >= HEAVY e pesado. */
export const INVENTORY = { FLAT_RATIO: 0.005, HEAVY_RATIO: 0.5 } as const;
/** Taxa de funding horaria em bps. */
export const FUNDING = { NEUTRAL_BPS: 0.1, EXTREME_BPS: 1 } as const;
/** Relogio em UTC. A Hyperliquid liquida funding de hora em hora. */
export const CLOCK = { SETTLE_MIN: 5, FUNDING_FROM_MIN: 55, DEAD_FROM_HOUR: 2, DEAD_TO_HOUR: 5 } as const;

/** Entrada do adapter: o que o venue ja tem, sem importar tipos do venue aqui. */
export interface SnapshotInput {
  ts: number;
  sleeve: string;
  book: {
    bid: number;
    ask: number;
    mid: number;
    spreadBps: number;
    depthBps: { [band: string]: { bid: number; ask: number } };
  };
  bookAgeMs: number;
  returnsBps: { last1: number; last5: number; last20: number };
  volBps: number | null;
  prints: { count: number; buySz: number; sellSz: number; cvdSz: number };
  position: { side: "long" | "short" | "flat"; size: number };
  account: { equityUsd: number; unrealizedUsd: number; leverage: number | null } | null;
  fundingBps: number | null;
  mark: number | null;
  bankrollUsd: number;
  maxLeverage: number;
}

/** Adapter spec 3.1: mapeia nomes do repo em vez de renomear o bot inteiro. */
export function toSnapshot(input: SnapshotInput): Snapshot {
  const b = input.book;
  const near = b.depthBps["10"] ?? { bid: 0, ask: 0 };
  const depthUsd = (near.bid + near.ask) * b.mid;
  const size = input.position.size;
  const reference = (input.account?.equityUsd ?? 0) > 0 ? input.account!.equityUsd : input.bankrollUsd;
  return {
    ts: input.ts,
    sleeve: input.sleeve,
    coin: input.sleeve,
    mid: b.mid,
    mark: input.mark,
    bid: b.bid,
    ask: b.ask,
    spread_bps: b.spreadBps,
    bid_sz: near.bid,
    ask_sz: near.ask,
    depth_usd_10bps: depthUsd,
    funding_bps: input.fundingBps,
    pos_side: input.position.side,
    pos_sz: size,
    pos_notional_usd: Math.abs(size) * b.mid,
    upnl_usd: input.account?.unrealizedUsd ?? 0,
    lev: input.account?.leverage ?? null,
    book_age_ms: input.bookAgeMs,
    returns_bps: input.returnsBps,
    vol_bps: input.volBps,
    prints: {
      count: input.prints.count,
      buy_sz: input.prints.buySz,
      sell_sz: input.prints.sellSz,
      cvd_sz: input.prints.cvdSz,
    },
    equity_usd: input.account?.equityUsd ?? 0,
    bankroll_usd: reference,
    max_leverage: input.maxLeverage,
  };
}

export function spreadBucket(bps: number): string {
  if (!(bps > 0) || bps > SPREAD.WIDE_BPS) return "unfillable";
  if (bps > SPREAD.NORMAL_BPS) return "wide";
  if (bps > SPREAD.TIGHT_BPS) return "normal";
  return "tight";
}

export function depthBucket(usd: number): string {
  if (!(usd > 0)) return "empty";
  if (usd < DEPTH_USD.THIN) return "thin";
  if (usd < DEPTH_USD.DEEP) return "ok";
  return "deep";
}

export function flowBucket(prints: Snapshot["prints"]): string {
  const vol = prints.buy_sz + prints.sell_sz;
  if (prints.count < FLOW.QUIET_PRINTS || vol <= 0) return "quiet";
  if (prints.count >= FLOW.BOT_WAR_PRINTS) return "bot_war";
  const skew = prints.cvd_sz / vol;
  if (skew >= FLOW.ONE_SIDED) return "lift";
  if (skew <= -FLOW.ONE_SIDED) return "dump";
  return "two_way";
}

export function tapeBucket(returns: Snapshot["returns_bps"], volBps: number | null): string {
  // Ensaio de buckets (PLANO-FUSAO secao 17): o tape lia `last5` — 5 TICKS, ou seja 10 s com TICK_MS=2000
  // (a serie `mids` e empilhada uma vez por tick) — e o `outcome` mede 900 s: 90x de diferenca.
  // Medido: 226 de 235 ciclos com |mov 15 min| >= 10 bps vinham com `tape = flat`, e `flat` tinha
  // mediana de movimento MAIOR que `grinding` (ordem nao monotona). Passa a ler `last20` (20 ticks ~ 40 s),
  // que o processo JA calcula: nao se inventa serie nova. Regra 8: nada de janela do rótulo (`mark_plus_15m`).
  // Os limiares GRIND/MOVE/VIOLENT ficam intocados neste passo.
  const short = returns.last20;
  const abs = Math.abs(short);
  if (abs >= TAPE.VIOLENT_BPS || (volBps ?? 0) >= TAPE.VIOLENT_BPS) return "violent";
  if (abs >= TAPE.MOVE_BPS) return short > 0 ? "pumping" : "dumping";
  if (abs >= TAPE.GRIND_BPS) return "grinding";
  return "flat";
}

export function inventoryBucket(snap: Pick<Snapshot, "pos_sz" | "pos_notional_usd" | "pos_side" | "bankroll_usd">): string {
  const ratio = snap.bankroll_usd > 0 ? snap.pos_notional_usd / snap.bankroll_usd : 1;
  if (snap.pos_side === "flat" || snap.pos_sz === 0 || ratio < INVENTORY.FLAT_RATIO) return "flat";
  const heavy = ratio >= INVENTORY.HEAVY_RATIO;
  if (snap.pos_side === "long") return heavy ? "long_heavy" : "long_small";
  return heavy ? "short_heavy" : "short_small";
}

export function fundingBucket(bps: number | null): string {
  if (bps == null || !Number.isFinite(bps) || Math.abs(bps) < FUNDING.NEUTRAL_BPS) return "pay_neutral";
  if (Math.abs(bps) >= FUNDING.EXTREME_BPS) return "extreme";
  return bps > 0 ? "pay_long" : "pay_short";
}

export function clockBucket(ts: number): string {
  const at = new Date(ts);
  const min = at.getUTCMinutes();
  const hour = at.getUTCHours();
  if (min >= CLOCK.FUNDING_FROM_MIN) return "funding_window";
  if (min < CLOCK.SETTLE_MIN) return "open_liq";
  if (hour >= CLOCK.DEAD_FROM_HOUR && hour < CLOCK.DEAD_TO_HOUR) return "dead";
  return "mid";
}

/**
 * Spec 3.2 — funcao pura. Sem digitos, ≤ STATE_MAX_WORDS tokens, deterministica.
 * A ordem e fixa (spread depth flow tape inventory funding clock) para o mesmo
 * snapshot produzir sempre a mesma linha.
 */
export function toState(snap: Snapshot): string {
  const tokens = [
    spreadBucket(snap.spread_bps),
    depthBucket(snap.depth_usd_10bps),
    flowBucket(snap.prints),
    tapeBucket(snap.returns_bps, snap.vol_bps),
    inventoryBucket(snap),
    fundingBucket(snap.funding_bps),
    clockBucket(snap.ts),
  ];
  if (tokens.length > config.lab.stateMaxWords) {
    throw new Error(`state has ${tokens.length} tokens, max ${config.lab.stateMaxWords}`);
  }
  const state = tokens.join(" ");
  if (/\d/.test(state)) throw new Error(`state carries a digit: ${state}`);
  return state;
}

/** Estance nao numerica: a spec proibe interpolar tamanho ou decimais (D4). */
export function stanceOf(snap: Pick<Snapshot, "pos_side">): string {
  return snap.pos_side;
}

/**
 * Le a estance de dentro do proprio `state`: a POLICY so ve as doze palavras,
 * por isso o template nao recebe o snapshot (decisao A4/D4).
 */
export function stanceFromState(state: string): "flat" | "long" | "short" {
  const tokens = state.split(/\s+/);
  if (tokens.includes("long_small") || tokens.includes("long_heavy")) return "long";
  if (tokens.includes("short_small") || tokens.includes("short_heavy")) return "short";
  return "flat";
}
