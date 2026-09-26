/**
 * O sigma no desk (POLICY=sigma).
 *
 * Tudo o que aqui esta e LEITURA do que o motor ja decidiu: o desk nao re-deriva o sinal. O `s`, a
 * EMA24 e a barra lida viajam no evento (`src/trader.ts`) com os nomes do ledger, e este modulo so
 * lhes da forma para o ecra.
 *
 * Horas em UTC com o sufixo `Z`, sempre. O relogio da regra e a H1 UTC e o ledger grava `t` em UTC;
 * ler a mesma linha em hora local foi, uma vez, a razao de o painel discordar do motor.
 */
import type { BlockEvent, Decision } from "@/lib/types";

const H1_MS = 3_600_000;

/** O evento traz o estado do sigma? So a POLICY=sigma o escreve. */
export function isSigmaDecision(d: Decision | null | undefined): boolean {
  return Boolean(d) && typeof d?.bar_t === "number";
}

/** A sleeve (ou o que ja chegou dela) fala sigma? */
export function isSigmaFeed(events: BlockEvent[], latest: BlockEvent | null | undefined): boolean {
  if (isSigmaDecision(latest?.decision)) return true;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (isSigmaDecision(events[i]?.decision)) return true;
  }
  return false;
}

/**
 * O lado que o `s` diz. `0` nao e "hold": e CAIXA, a regra a dizer que nao quer posicao nenhuma.
 * Manter a que esta e outra coisa (o `s` manteve-se, e isso ve-se na barra lida).
 */
export function sideWord(s: number | null | undefined): "BUY" | "SELL" | "CAIXA" {
  if (typeof s !== "number" || !Number.isFinite(s) || s === 0) return "CAIXA";
  return s > 0 ? "BUY" : "SELL";
}

/** A cor do lado. Sem sinal, e tinta neutra: caixa nao e compra nem venda. */
export function sideInk(s: number | null | undefined): string {
  if (typeof s !== "number" || !Number.isFinite(s) || s === 0) return "var(--ink-2)";
  return s > 0 ? "var(--buy-ink)" : "var(--sell-ink)";
}

/** O `s` como se le no ledger: `+1`, `-1` ou `0`. */
export function fmtS(s: number | null | undefined): string {
  if (typeof s !== "number" || !Number.isFinite(s)) return "-";
  return s > 0 ? "+1" : s < 0 ? "-1" : "0";
}

/** "11:00Z". A H1 que decidiu fecha em `bar_t` mais uma hora, e esse e o instante da decisao. */
export function fmtH1Closed(barT: number | null | undefined): string {
  if (typeof barT !== "number" || !Number.isFinite(barT)) return "--:--Z";
  const d = new Date(barT + H1_MS);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}Z`;
}

/** "11:02:14Z" (o tick), em UTC. Sem segundos: "11:02Z". */
export function fmtUtcClock(ts: number | null | undefined, withSeconds = true): string {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return withSeconds ? "--:--:--Z" : "--:--Z";
  const d = new Date(ts);
  const hm = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  return withSeconds ? `${hm}:${pad2(d.getUTCSeconds())}Z` : `${hm}Z`;
}

/** Um numero com sinal: "+0.4041". */
export function fmtSigned(n: number | null | undefined, d = 4): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "-";
  return `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(d)}`;
}

/**
 * Um nivel do motor (hl2, close, EMA) com a precisao do ledger: 4 casas.
 *
 * `fmtPrice` arredonda a 2 casas acima de 100, e sob o SOL (por volta de 121) a decisao vive em
 * decimos: 120.78 esconde os 0.4041 que fazem o `s`. O painel tem de dar o numero que se cruza com
 * a linha do ledger, nao um numero parecido.
 */
export function fmtLevel(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "-";
  return n.toFixed(4);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Uma H1 lida, com o tick que a leu e o que aconteceu dentro daquela hora. */
export interface Episode {
  /** Abertura da barra lida. A decisao e no fecho dela (`barT + 1h`). */
  barT: number;
  /** O tick que LEU a H1 nova: o primeiro daquela hora, o unico com a leitura fresca. */
  read: BlockEvent;
  /** Quantos ticks fundidos naquela hora (uma leitura, muitos ticks). */
  ticks: number;
  fills: BlockEvent[];
  quotes: BlockEvent[];
  /** Ordens que o venue recusou (FIX-42): a entrada que existia e nao entrou. */
  refused: BlockEvent[];
}

/**
 * Agrupa por H1 LIDA, e nao por tick. A leitura repete-se em todos os ticks da hora (uma H1, um
 * `s`), por isso o episodio e do fecho: e o que se ve no grafico e o que o ledger grava.
 */
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

/** Uma marca do `s` no grafico, no FECHO da H1 que decidiu (nunca a cada tick). */
export interface SigmaSide {
  /** Segundo Unix do fecho da H1, que e o instante da decisao. */
  time: number;
  side: "buy" | "sell";
}

/** Um veto de pavio (F2): a barra em que so o pavio cruzou a EMA e o close ficou no lado velho. */
export interface SigmaVeto {
  time: number;
  /** O `hl2` da barra lida, que e o valor que a regra mediu. */
  price: number;
}

/**
 * As marcas do sigma no grafico: uma seta por fecho de H1 com lado, e um x por veto de pavio.
 *
 * Sai tudo dos eventos do fio, e nada disto e calculado no browser a partir das velas: a barra do
 * grafico e agregada dos prints de 1 s e nao e a H1 que o motor leu. Uma H1, uma marca.
 */
export function sigmaMarks(events: BlockEvent[], limit = 200): { sides: SigmaSide[]; vetoes: SigmaVeto[] } {
  const sides: SigmaSide[] = [];
  const vetoes: SigmaVeto[] = [];
  for (const ep of groupEpisodes(events, limit)) {
    const d = ep.read.decision;
    const time = Math.round((ep.barT + H1_MS) / 1000);
    const s = d?.s;
    // `s = 0` e CAIXA: a regra nao quer lado nenhum, e nao ha seta para desenhar.
    if (typeof s === "number" && s !== 0) sides.push({ time, side: s > 0 ? "buy" : "sell" });
    if (d?.wick_veto && typeof d.hl2 === "number") vetoes.push({ time, price: d.hl2 });
  }
  // O grafico exige marcas em ordem crescente de tempo.
  sides.sort((a, b) => a.time - b.time);
  vetoes.sort((a, b) => a.time - b.time);
  return { sides, vetoes };
}
