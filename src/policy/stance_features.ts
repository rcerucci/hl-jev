/**
 * Features da postura: u no canal de L barras de 5 min e s contra a EMA 24 H1.
 * Constantes pinadas no ensaio dos extremos — nao se afinam aqui.
 */
export const STANCE_L = 130;
export const STANCE_EMA_N = 24;
export const BAR_5M_MS = 300_000;

export interface StanceBar {
  t: number;
  high: number;
  low: number;
  mid: number;
}

export function emaSmaSeed(xs: number[], n = STANCE_EMA_N): (number | null)[] {
  const out: (number | null)[] = [];
  const k = 2 / (n + 1);
  let e: number | null = null;
  for (let i = 0; i < xs.length; i++) {
    if (i < n - 1) {
      out.push(null);
      continue;
    }
    if (i === n - 1) {
      e = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
      out.push(e);
      continue;
    }
    e = xs[i]! * k + (e as number) * (1 - k);
    out.push(e);
  }
  return out;
}

export function lastClosed(bars: StanceBar[], now: number, stepMs: number): StanceBar | null {
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i]!.t + stepMs <= now) return bars[i]!;
  }
  return null;
}

export function rangeU(bars: StanceBar[], at: StanceBar, L = STANCE_L): number | null {
  const end = bars.findIndex((b) => b.t === at.t);
  if (end < L - 1) return null;
  const win = bars.slice(end - L + 1, end + 1);
  let hi = -Infinity;
  let lo = Infinity;
  for (const b of win) {
    if (b.high > hi) hi = b.high;
    if (b.low < lo) lo = b.low;
  }
  if (!(hi > lo)) return 0.5;
  return Math.min(1, Math.max(0, (at.mid - lo) / (hi - lo)));
}

export function signVsEma(mid: number, ema: number | null): number {
  if (ema == null || !Number.isFinite(ema)) return 0;
  if (mid > ema) return 1;
  if (mid < ema) return -1;
  return 0;
}

/** EMA da ultima H1 com close_ts <= open_ts da 5m. */
export function emaAt5m(h1: StanceBar[], openTs5m: number): number | null {
  if (!h1.length) return null;
  const emas = emaSmaSeed(h1.map((b) => b.mid));
  let idx = -1;
  for (let i = 0; i < h1.length; i++) {
    const closeTs = h1[i]!.t + 3_600_000;
    if (closeTs <= openTs5m) idx = i;
  }
  return idx >= 0 ? emas[idx] ?? null : null;
}

export function stanceFeatures(
  bars5: StanceBar[],
  bars1h: StanceBar[],
  now: number,
): { mid_5m: number; u: number; s: number; ema_h1: number | null } | null {
  const last = lastClosed(bars5, now, BAR_5M_MS);
  if (!last) return null;
  const u = rangeU(bars5, last);
  if (u == null) return null;
  const ema = emaAt5m(bars1h, last.t);
  return { mid_5m: last.mid, u, s: signVsEma(last.mid, ema), ema_h1: ema };
}
