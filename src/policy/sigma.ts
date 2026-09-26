/**
 * POLICY=sigma: o nucleo `s` H1. Maquina de inventario buy / sell / hold / caixa.
 * Nao e oraculo de PnL. Sem rede, sem Jev.
 *
 * `s = sign(hl2 - EMA24)` da vela H1 **ja fechada**, com a EMA calculada sobre as barras
 * **anteriores** a essa (sem lookahead). Sem `u`, sem canal, sem chao/tecto: a unica entrada e
 * o `s`.
 *
 * Veto de pavio (F2): se o `s` quer virar e so o **wick** cruzou a EMA — o `hl2` passou para o
 * lado novo mas o **close** ficou no lado velho — a barra e ignorada e o `s` mantem-se. Um close
 * que confirma o lado novo flipa.
 *
 * raw    ∈ {buy, sell, caixa}        (caixa sse s == 0: preco exactamente na EMA)
 * signal ∈ {buy, sell, hold, caixa}  — hold sse raw == raw anterior
 *
 * F3 — circuit breaker de chop: 3 viradas em 12 h armam 6 h de caixa. A unidade e a **H1
 * fechada**: o relogio do CB sao os timestamps das velas fechadas, e repetir a decisao dentro
 * da mesma hora (tick de 5m) nao conta duas vezes. Virada = `signal` buy ou sell que muda de
 * lado: `hold` e veto de pavio nao contam. Ao expirar, o `s` (+ veto) vigente volta a valer e o
 * contador recomeca — o CB nao se alimenta das viradas que ele proprio provocou.
 */
import { config } from "../config";
import { loadRegime, saveRegime } from "../regime";
import type { Act, Policy, PolicyCtx, SigmaBar, StanceRaw, StanceSignal, Verdict } from "../risk/types";

/**
 * H4 — as constantes do motor vivem no `config.ts` (`config.sigma`), numa fonte so: `emaN`,
 * o circuit breaker, a espera do fill e as taxas. Aqui fica o que e do **sinal** apenas.
 */
export const SIGMA = {
  CONF_ON_SIDE: 0.9,
  CONF_ON_HOLD: 0.5,
  HOSTILE_FALSE: 0.1,
} as const;

/** Estado do CB de um sleeve. `flips` guarda os instantes das H1 fechadas que viraram. */
export interface CbState {
  flips: number[];
  until: number;
  lastClosedAt: number;
}

export interface CbDecision {
  active: boolean;
  flips_12h: number;
  until: number;
}

export function newCbState(): CbState {
  return { flips: [], until: 0, lastClosedAt: 0 };
}

export function cbView(st: CbState): CbDecision {
  return { active: st.until > st.lastClosedAt, flips_12h: st.flips.length, until: st.until };
}

/**
 * Avanca o CB numa H1 fechada. Idempotente dentro da mesma hora: `closedAt` igual ao da ultima
 * avaliacao devolve o estado sem contar nada — e o que impede o tick de 5m de virar inventario.
 */
export function cbStep(st: CbState, closedAt: number, flip: boolean): CbDecision {
  if (closedAt === st.lastClosedAt) return cbView(st);
  st.lastClosedAt = closedAt;
  // Expirou: o s volta a valer, e o contador recomeca.
  if (st.until !== 0 && closedAt >= st.until) {
    st.until = 0;
    st.flips = [];
  }
  if (flip && st.until === 0) {
    st.flips = st.flips.filter((t) => t > closedAt - config.sigma.cbWindowMs);
    st.flips.push(closedAt);
    if (st.flips.length >= config.sigma.cbFlips) st.until = closedAt + config.sigma.cbCaixaMs;
  }
  return cbView(st);
}

/** Uma virada e a mudanca de lado do evento: hold e veto nao contam. */
export function isFlip(prev: StanceRaw | undefined, raw: StanceRaw): boolean {
  if (prev !== "buy" && prev !== "sell") return false;
  if (raw !== "buy" && raw !== "sell") return false;
  return raw !== prev;
}

/** `hl2` da vela: o sigma compara a mediana do intervalo H1 contra a EMA. */
export function hl2Of(b: SigmaBar): number {
  return (b.high + b.low) / 2;
}

/** EMA com seed SMA sobre uma serie. `null` enquanto nao houver `n` valores. */
export function emaSigma(xs: number[], n: number = config.sigma.emaN): (number | null)[] {
  const out: (number | null)[] = [];
  const k = 2 / (n + 1);
  let e: number | null = null;
  for (let i = 0; i < xs.length; i++) {
    if (i < n - 1) { out.push(null); continue; }
    if (i === n - 1) { e = xs.slice(0, n).reduce((a, b) => a + b, 0) / n; out.push(e); continue; }
    e = xs[i]! * k + (e as number) * (1 - k);
    out.push(e);
  }
  return out;
}

/** `raw` so olha para o `s`. Sem `u`, sem canal, sem chao/tecto — e o teste prova-o. */
export function sigmaRaw(s: number): StanceRaw {
  if (s === 0) return "caixa";
  return s > 0 ? "buy" : "sell";
}

/** `hold` sse o raw nao mudou (mesmo contrato do stance). */
export function signalFrom(raw: StanceRaw, prev: StanceRaw | undefined): StanceSignal {
  return prev !== undefined && raw === prev ? "hold" : raw;
}

/** O instante do ciclo, lido do proprio `cycle_id` (`YYYYMMDDTHHMMSSZ-SLEEVE`). */
export function cycleTsMs(cycleId: string): number {
  const m = /^(\d{8})T(\d{6})Z/.exec(cycleId);
  if (!m) return 0;
  const d = m[1]!;
  const t = m[2]!;
  return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)),
    Number(t.slice(0, 2)), Number(t.slice(2, 4)), Number(t.slice(4, 6)));
}

/**
 * Indice da H1 **ja fechada** no instante do ciclo — a ultima com `t + 1h <= at`. E o que faz
 * "5m sozinho nao muda o s": dentro da mesma hora, a mesma vela, o mesmo `s`.
 */
export function lastClosedH1(bars: SigmaBar[], atMs: number): number {
  let idx = -1;
  for (let i = 0; i < bars.length; i++) {
    if (bars[i]!.t + 3_600_000 <= atMs) idx = i;
  }
  return idx;
}

/**
 * O passo do sigma numa vela fechada: o `s` candidato (hl2 contra a EMA das barras anteriores) e
 * o veto de pavio. `sPrev` = `s` vigente (0 = ainda sem estado). `null` sem historico para a EMA
 * — e sem historico a policy nao inventa lado.
 */
export function sigmaStep(
  bars: SigmaBar[],
  atMs: number,
  sPrev: number,
): { s: number; veto: boolean; hl2: number; close: number; ema: number; t: number; closedAt: number } | null {
  const idx = lastClosedH1(bars, atMs);
  if (idx < config.sigma.emaN) return null;
  const at = bars[idx]!;
  const emas = emaSigma(bars.slice(0, idx).map(hl2Of));
  const ema = emas[emas.length - 1] ?? null;
  if (ema == null) return null;
  const hl2 = hl2Of(at);
  const sRaw = hl2 > ema ? 1 : hl2 < ema ? -1 : 0;
  const sClose = at.close > ema ? 1 : at.close < ema ? -1 : 0;
  const querVirar = sPrev !== 0 && sRaw !== 0 && sRaw !== sPrev;
  const veto = querVirar && sClose === sPrev;
  return { s: veto ? sPrev : sRaw, veto, hl2, close: at.close, ema, t: at.t, closedAt: at.t + 3_600_000 };
}

function actOf(signal: StanceSignal): Act {
  if (signal === "buy" || signal === "sell") return signal;
  return "hold";
}

export class SigmaPolicy implements Policy {
  readonly name = "sigma";
  private prevRaw = new Map<string, StanceRaw>();
  private sState = new Map<string, number>();
  private cbState = new Map<string, CbState>();
  private hydrated = new Set<string>();

  /**
   * `regimeDir` grava `s` / prevRaw / CB entre processos. Ausente (testes, `new SigmaPolicy()`)
   * o estado continua so em memoria.
   */
  constructor(private regimeDir?: string) {}

  private hydrate(sleeve: string) {
    if (!this.regimeDir || this.hydrated.has(sleeve)) return;
    this.hydrated.add(sleeve);
    const got = loadRegime(this.regimeDir, sleeve);
    if (!got) return;
    this.sState.set(sleeve, got.s);
    if (got.prevRaw) this.prevRaw.set(sleeve, got.prevRaw);
    this.cbState.set(sleeve, { flips: [...got.cb.flips], until: got.cb.until, lastClosedAt: got.cb.lastClosedAt });
  }

  private persist(sleeve: string) {
    if (!this.regimeDir) return;
    saveRegime(this.regimeDir, sleeve, {
      s: this.sState.get(sleeve) ?? 0,
      prevRaw: this.prevRaw.get(sleeve),
      cb: this.cbState.get(sleeve) ?? newCbState(),
    });
  }

  async decide(_state: string, cycleId: string, ctx?: PolicyCtx): Promise<Verdict> {
    const sleeve = cycleId.includes("-") ? cycleId.slice(cycleId.indexOf("-") + 1) : cycleId;
    this.hydrate(sleeve);
    const prev = ctx?.raw_prev ?? this.prevRaw.get(sleeve);
    const step = ctx?.h1 ? sigmaStep(ctx.h1, cycleTsMs(cycleId), this.sState.get(sleeve) ?? 0) : null;
    const cb = this.cbState.get(sleeve) ?? newCbState();
    this.cbState.set(sleeve, cb);
    let raw: StanceRaw;
    let cbNow: CbDecision;
    if (!step) {
      raw = "caixa";
      cbNow = cbView(cb);
    } else {
      const lado = sigmaRaw(step.s);
      cbNow = cbStep(cb, step.closedAt, isFlip(prev, lado));
      raw = cbNow.active ? "caixa" : lado;
      this.sState.set(sleeve, step.s);
    }
    const signal = signalFrom(raw, prev);
    this.prevRaw.set(sleeve, raw);
    this.persist(sleeve);
    const act = actOf(signal);
    const side = act === "hold" ? SIGMA.CONF_ON_HOLD : SIGMA.CONF_ON_SIDE;
    const rest = (1 - side) / 2;
    return {
      cycle_id: cycleId,
      model: this.name,
      latency_ms: 0,
      act,
      act_probs: {
        buy: act === "buy" ? side : rest,
        sell: act === "sell" ? side : rest,
        hold: act === "hold" ? side : rest,
      },
      act_conf: side,
      too_hostile: SIGMA.HOSTILE_FALSE,
      raw_ok: true,
      raw,
      signal,
      s: step?.s,
      ema_h1: step?.ema ?? null,
      bar_t: step?.t,
      hl2: step?.hl2,
      bar_close: step?.close,
      wick_veto: step?.veto ?? false,
      cb_active: cbNow.active,
      cb_flips_12h: cbNow.flips_12h,
      cb_until: cbNow.until,
      note: `sigma s=${step?.s ?? "na"} hl2=${step ? step.hl2.toFixed(2) : "na"} ema=${step ? step.ema.toFixed(2) : "na"} veto=${step?.veto ?? false} cb=${cbNow.active ? "caixa" : "livre"} flips12h=${cbNow.flips_12h}`,
    };
  }
}
