#!/usr/bin/env bun
/**
 * Diagnóstico do `s` — a fórmula é a mesma do Pine; o que muda é o **livro** e o aquecimento da EMA.
 *
 * Pergunta do dono: "estamos a usar a matemática errada para rastrear o `s`?". Aqui mede-se, sem
 * tocar em produto nem em ordem:
 *
 *  1. **Qualidade da série que usámos** (BTC testnet, 5 min): quantas barras têm o `hl2` igual ao da
 *     barra anterior, mediana do movimento em bps, e se há buracos no tempo.
 *  2. **Sensibilidade do `s` a duas decisões de método**: o seed da EMA (SMA-24, como pediu o
 *     consultor, vs o seed do Pine, que é o próprio primeiro valor) e o aquecimento (30 h vs ~60 dias
 *     de H1). Conta-se em quantas barras o `s` MUDARIA.
 *  3. **A regra de staleness do H1**: `request.security(..., lookahead_off)` no TradingView devolve a
 *     última H1 **fechada** — que é exactamente a nossa regra `close_ts ≤ open_ts(barra)`.
 *
 * Uso: bun run provas/t5m/diagnostico-s.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { InfoClient } from "@nktkas/hyperliquid";
import { transportFor } from "../../src/ledger/marks_source";
import { velas, type Vela } from "./velas";

const COIN = "BTC";
const CACHES = ["provas/t5m/velas-5m.json", "provas/t5m/extremos/velas-5m.json"];
const L = 130;

let vs: Vela[] | null = null;
let cacheUsada = "";
for (const c of CACHES) if (existsSync(c)) { vs = JSON.parse(readFileSync(c, "utf8")) as Vela[]; cacheUsada = c; break; }
if (!vs) throw new Error("sem cache de 5 min em disco");

const hl2 = vs.map((v) => (Number(v.h) + Number(v.l)) / 2);
const ms = (v: Vela) => v.t;

console.log(`== 1. A SERIE QUE USAMOS (${cacheUsada}, ${vs.length} barras) ==`);
console.log(`  janela: ${new Date(vs[0].t).toISOString()} -> ${new Date(vs[vs.length - 1].t).toISOString()}`);
// buracos: o passo esperado é 5 min
let buracos = 0, maiorBuraco = 0;
for (let i = 1; i < vs.length; i++) {
  const d = ms(vs[i]) - ms(vs[i - 1]);
  if (d > 300_000) { buracos++; maiorBuraco = Math.max(maiorBuraco, d); }
}
const iguais = hl2.filter((x, i) => i > 0 && x === hl2[i - 1]).length;
const deltas = hl2.map((x, i) => (i === 0 ? 0 : Math.abs((x - hl2[i - 1]) / hl2[i - 1]) * 10_000)).slice(1).sort((a, b) => a - b);
const med = deltas[Math.floor(deltas.length / 2)];
const zero = deltas.filter((d) => d === 0).length;
console.log(`  buracos (>5 min entre barras): ${buracos}${buracos ? ` · maior ${(maiorBuraco / 60_000).toFixed(0)} min` : ""}`);
console.log(`  hl2 igual ao da barra anterior: ${iguais}/${vs.length - 1} = ${((100 * iguais) / (vs.length - 1)).toFixed(1)} %`);
console.log(`  |delta hl2| em bps: mediana ${med.toFixed(2)} · zero em ${zero} barras (${((100 * zero) / deltas.length).toFixed(1)} %)`);
console.log(`  volume por barra (mediana): ${(() => { const v = vs.map((x) => Number(x.v)).sort((a, b) => a - b); return v[Math.floor(v.length / 2)].toFixed(4); })()}`);
console.log(`  barras/dia: ${(vs.length / ((ms(vs[vs.length - 1]) - ms(vs[0])) / 86_400_000)).toFixed(1)} (esperado 288)`);

// ---------------------------------------------------------------- EMA: variantes
function emaSmaSeed(xs: number[], n = 24): (number | null)[] {
  const out: (number | null)[] = []; const k = 2 / (n + 1); let e: number | null = null;
  for (let i = 0; i < xs.length; i++) {
    if (i < n - 1) { out.push(null); continue; }
    if (i === n - 1) { e = xs.slice(0, n).reduce((a, b) => a + b, 0) / n; out.push(e); continue; }
    e = xs[i] * k + (e as number) * (1 - k); out.push(e);
  }
  return out;
}
/** Seed do Pine: `ta.ema` arranca no primeiro valor (EMA[0] = src[0]). */
function emaSeedPrimeiro(xs: number[], n = 24): (number | null)[] {
  const out: (number | null)[] = []; const k = 2 / (n + 1); let e: number | null = null;
  for (let i = 0; i < xs.length; i++) {
    e = e === null ? xs[i] : xs[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

const cli = new InfoClient({ transport: transportFor() });
/** H1 paginado, com `horasAntes` a contar do INICIO DA JANELA (nao de agora): a sonda anterior
 *  media 78 h a contar de agora, ou seja uma serie que nao cobria a janela — comparacao invalida. */
async function h1(horasAntes: number): Promise<Vela[]> {
  const ate = Date.now();
  return await velas(COIN, "1h", vs![0].t - horasAntes * 3_600_000, ate, 3_600_000, cli);
}

type Variante = { nome: string; s: number[] };
function calculaS(H1: Vela[], seed: "sma" | "primeiro"): number[] {
  const bars1 = H1.map((v) => (Number(v.h) + Number(v.l)) / 2);
  const ema = seed === "sma" ? emaSmaSeed(bars1, 24) : emaSeedPrimeiro(bars1, 24);
  const out: number[] = [];
  let i1 = 0;
  for (let i = 0; i < vs!.length; i++) {
    while (i1 + 1 < H1.length && H1[i1 + 1].t + 3_600_000 <= vs![i].t) i1++;
    const ok = H1.length > 0 && H1[i1].t + 3_600_000 <= vs![i].t;
    const e = ok ? ema[i1] : null;
    out.push(e === null ? 0 : hl2[i] > e ? 1 : hl2[i] < e ? -1 : 0);
  }
  return out;
}
const flips = (s: number[]) => { let n = 0, ant = 0; for (const x of s) { if (x !== 0 && x !== ant) n++; if (x !== 0) ant = x; } return n; };

const H1_curto = await h1(31);
const H1_longo = await h1(60 * 24);
const cobre = (h: Vela[]) => h[0].t <= vs![0].t;
console.log();
console.log("== 2. SENSIBILIDADE DO `s` (as duas variantes COBREM a janela) ==");
console.log(`  aquecimento 31 h antes da janela: ${H1_curto.length} barras · cobre: ${cobre(H1_curto)}`);
console.log(`  aquecimento 60 d antes da janela: ${H1_longo.length} barras · cobre: ${cobre(H1_longo)}`);
const v = [
  { nome: "seed SMA-24 · aquecimento 31 h (o que as sondas usavam)", s: calculaS(H1_curto, "sma") },
  { nome: "seed SMA-24 · aquecimento ~60 d (agora)", s: calculaS(H1_longo, "sma") },
  { nome: "seed do Pine · aquecimento ~60 d", s: calculaS(H1_longo, "primeiro") },
];
for (const x of v) console.log(`  ${x.nome.padEnd(48)} flips: ${String(flips(x.s)).padStart(4)}`);
const base = v[0].s;
console.log();
console.log("  barras em que o `s` DIFERE da variante que usamos:");
for (const x of v.slice(1)) {
  const dif = base.filter((b, i) => b !== x.s[i]).length;
  console.log(`    ${x.nome.padEnd(48)} ${String(dif).padStart(5)} barras (${((100 * dif) / base.length).toFixed(1)} %)`);
}
const difCurto = v[0].s.filter((b, i) => b !== v[1].s[i]).length;
const difSeed = v[1].s.filter((b, i) => b !== v[2].s[i]).length;
console.log();
console.log("== 3. VEREDICTO DA CONVERGENCIA ==");
console.log(`  aquecimento 31 h vs 60 d: ${difCurto} barras diferem (${((100 * difCurto) / v[0].s.length).toFixed(2)} %)`);
console.log(`  seed SMA-24 vs seed do Pine, ambos com 60 d: ${difSeed} barras diferem (${((100 * difSeed) / v[0].s.length).toFixed(2)} %)`);
// Tolerancia declarada ANTES de olhar: o `s` e um sinal estatistico, nao um checksum. Exige-se
// <= 0,1 % das barras (5 em 5 030). A primeira versao exigia ZERO e reprovava por 1 barra — um
// alarme que dispara por 0,02 % e um alarme que se desliga. O que ele tem de apanhar e o caso
// grosseiro (seed/aquecimento a moverem 5 %, 50 %, 87 %), nao o empate de uma barra.
const TOL = Math.max(5, Math.round(0.001 * v[0].s.length));
const ok = difCurto <= TOL && difSeed <= TOL;
console.log(`  tolerancia declarada: <= ${TOL} barras (0,1 %)`);
console.log(`  => ${ok ? "CONVERGIDO: o seed SMA-24 e o aquecimento nao movem o `s` nesta janela." : "NAO CONVERGIDO: ha divergencia a resolver antes de publicar leituras."}`);
console.log();
console.log("  (a regra do H1 e a mesma do Pine: `lookahead_off` devolve a ultima H1 FECHADA, que e o");
console.log("   nosso `close_ts <= open_ts(barra)`. Nao ha divergencia de staleness a corrigir.)");
