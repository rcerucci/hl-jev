/**
 * O sigma no desk.
 *
 * O painel lateral le o que o motor ja decidiu no evento. O grafico precisa do
 * historico de `s` (o Pine mostra todas as H1): usa as velas H1 do tape com a
 * mesma regra do motor (hl2 vs EMA das barras anteriores + veto de pavio).
 */
import type { BlockEvent, Decision } from "@/lib/types";

const H1_MS = 3_600_000;
const EMA_N = 24;

export function isSigmaDecision(d: Decision | null | undefined): boolean {
  return Boolean(d) && typeof d?.bar_t === "number";
}

export function isSigmaFeed(events: BlockEvent[], latest: BlockEvent | null | undefined): boolean {
  if (isSigmaDecision(latest?.decision)) return true;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (isSigmaDecision(events[i]?.decision)) return true;
  }
  return false;
}

export function sideWord(s: number | null | undefined): "BUY" | "SELL" | "CAIXA" {
  if (typeof s !== "number" || !Number.isFinite(s) || s === 0) return "CAIXA";
  return s > 0 ? "BUY" : "SELL";
}

export function sideInk(s: number | null | undefined): string {
  if (typeof s !== "number" || !Number.isFinite(s) || s === 0) return "var(--ink-2)";
  return s > 0 ? "var(--buy-ink)" : "var(--sell-ink)";
}

export function fmtS(s: number | null | undefined): string {
  if (typeof s !== "number" || !Number.isFinite(s)) return "-";
  return s > 0 ? "+1" : s < 0 ? "-1" : "0";
}

export function fmtH1Closed(barT: number | null | undefined): string {
  if (typeof barT !== "number" || !Number.isFinite(barT)) return "--:--Z";
  const d = new Date(barT + H1_MS);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}Z`;
}

export function fmtUtcClock(ts: number | null | undefined, withSeconds = true): string {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return withSeconds ? "--:--:--Z" : "--:--Z";
  const d = new Date(ts);
  const hm = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  return withSeconds ? `${hm}:${pad2(d.getUTCSeconds())}Z` : `${hm}Z`;
}

export function fmtSigned(n: number | null | undefined, d = 4): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "-";
  return `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(d)}`;
}

export function fmtLevel(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "-";
  return n.toFixed(4);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export interface Episode {
  barT: number;
  read: BlockEvent;
  ticks: number;
  fills: BlockEvent[];
  quotes: BlockEvent[];
  refused: BlockEvent[];
}

export function groupEpisodes(events: BlockEvent[], limit = 40): Episode[] {
  const byBar = new Map<number, Episode>();
  for (const e of events) {
    const barT = e.decision?.bar_t;
    if (typeof barT !== "number") continue;
    let ep = byBar.get(barT);
    if (!ep) {
      ep = { barT, read: e, ticks: 0, fills: [], quotes: [], refused: [] };
      byBar.set(barT, ep);
    }
    ep.ticks += 1;
    if (e.fill) ep.fills.push(e);
    if (e.quote) {
      ep.quotes.push(e);
      if (e.quote.reason) ep.refused.push(e);
    }
  }
  return [...byBar.values()].sort((a, b) => b.barT - a.barT).slice(0, limit);
}

export interface SigmaSide {
  time: number;
  side: "buy" | "sell";
}

export interface SigmaVeto {
  time: number;
  price: number;
}

export function sigmaMarks(events: BlockEvent[], limit = 200): { sides: SigmaSide[]; vetoes: SigmaVeto[] } {
  const sides: SigmaSide[] = [];
  const vetoes: SigmaVeto[] = [];
  for (const ep of groupEpisodes(events, limit)) {
    const d = ep.read.decision;
    const time = Math.round(ep.barT / 1000);
    const s = d?.s;
    if (typeof s === "number" && s !== 0) sides.push({ time, side: s > 0 ? "buy" : "sell" });
    if (d?.wick_veto && typeof d.hl2 === "number") vetoes.push({ time, price: d.hl2 });
  }
  sides.sort((a, b) => a.time - b.time);
  vetoes.sort((a, b) => a.time - b.time);
  return { sides, vetoes };
}

export type H1Bar = { time: number; high: number; low: number; close: number };

function hl2Of(b: H1Bar): number {
  return (b.high + b.low) / 2;
}

function emaLast(xs: number[], n: number): number | null {
  if (xs.length < n) return null;
  const k = 2 / (n + 1);
  let e = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < xs.length; i++) e = xs[i]! * k + e * (1 - k);
  return e;
}

/** Historico de `s` sobre velas H1 do tape (`time` = abertura em segundos Unix). */
export function sigmaHistoryFromH1(
  candles: H1Bar[],
  nowMs = Date.now(),
): { sides: SigmaSide[]; vetoes: SigmaVeto[] } {
  const closed = candles.filter((c) => c.time * 1000 + H1_MS <= nowMs);
  const sides: SigmaSide[] = [];
  const vetoes: SigmaVeto[] = [];
  let sPrev = 0;
  for (let i = EMA_N; i < closed.length; i++) {
    const at = closed[i]!;
    const ema = emaLast(closed.slice(0, i).map(hl2Of), EMA_N);
    if (ema == null) continue;
    const hl2 = hl2Of(at);
    const sRaw = hl2 > ema ? 1 : hl2 < ema ? -1 : 0;
    const sClose = at.close > ema ? 1 : at.close < ema ? -1 : 0;
    const querVirar = sPrev !== 0 && sRaw !== 0 && sRaw !== sPrev;
    const veto = querVirar && sClose === sPrev;
    const s = veto ? sPrev : sRaw;
    const time = at.time;
    if (s !== 0) sides.push({ time, side: s > 0 ? "buy" : "sell" });
    if (veto) vetoes.push({ time, price: hl2 });
    sPrev = s;
  }
  return { sides, vetoes };
}
