#!/usr/bin/env bun
/**
 * Ensaio **flip-na-faixa** — entrada só quando o `s` muda de sinal *dentro da faixa do extremo*.
 *
 * Zero produto: nada em `src/`, sem motor, sem sessão, sem Pine. Reutiliza a série paginada de
 * `provas/t5m/velas.ts` (~5 030 barras de 5 min) e a cache em disco.
 *
 * A REGRA (é só isto — o #20 testou o toque sem flip, que NÃO se repete aqui):
 *
 *     flip para s = −1  E  u ≥ TECTO (0,75)  → SHORT
 *     flip para s = +1  E  u ≤ CHAO  (0,25)  → LONG
 *     qualquer outro flip (meio do canal)    → não evento
 *     toque no extremo sem flip              → não evento
 *
 * Dois rótulos sobre os MESMOS eventos, os dois publicados (não se escolhe depois):
 *   R1 holding fixo: mid em t_in + H, H ∈ {12, 36, 72} barras
 *   R2 até o próximo flip de `s` (qualquer flip, mesmo no meio do canal)
 *
 * Uso: bun run provas/t5m/flip-faixa/medir.ts [--sem-teste]
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { velas, type Vela } from "../velas";

const L = 130;
const CHAO = 0.25;
const TECTO = 0.75;
const FLAT = 10;
const HORIZONTES = [12, 36, 72] as const;
const COIN = "BTC";
const DIR = "provas/t5m/flip-faixa";
// Cache partilhada com o #20 (fora do git): nao se re-busca o que ja esta em disco.
const CACHES = ["provas/t5m/velas-5m.json", "provas/t5m/extremos/velas-5m.json"];

// ---------------------------------------------------------------- a regra, isolada para testar
/** `null` = não evento. `sAnterior` é o último `s != 0` antes desta barra. */
export function avaliaFlip(s: number, sAnterior: number, u: number): "long" | "short" | null {
  if (s === 0 || s === sAnterior) return null; // não há flip
  if (s === 1 && u <= CHAO) return "long";     // flip para cima no chão
  if (s === -1 && u >= TECTO) return "short";  // flip para baixo no tecto
  return null;                                  // flip no meio do canal
}

// ---------------------------------------------------------------- fonte
let vs: Vela[] | null = null;
let cacheUsada = "";
for (const c of CACHES) {
  if (existsSync(c)) { vs = JSON.parse(readFileSync(c, "utf8")) as Vela[]; cacheUsada = c; break; }
}
if (!vs) {
  const s = await velas(COIN, "5m", Date.now() - 20 * 24 * 3_600_000, Date.now(), 300_000);
  vs = s;
  cacheUsada = CACHES[0];
  writeFileSync(cacheUsada, JSON.stringify(vs));
}
const PEDIDAS = 5760; // o pedido do #20 (20 dias): fica gravado, para a truncagem não se perder
console.log("== FONTE ==");
console.log(`  cache: ${cacheUsada} (${vs.length} barras) — a serie usada e esta, byte a byte`);
if (vs.length < PEDIDAS * 0.9) {
  console.log(`  AVISO: a fonte de 5 min deste venue acaba em ~${vs.length} barras (~17,5 d); pedir 20 dias devolve o mesmo.`);
}

const h1: Vela[] = await velas(COIN, "1h", vs[0].t - 30 * 3_600_000, Date.now(), 3_600_000);

type Bar = { t: number; mid: number; h: number; l: number };
const bars: Bar[] = vs.map((v) => ({ t: v.t, mid: (Number(v.h) + Number(v.l)) / 2, h: Number(v.h), l: Number(v.l) }));
const H1: Bar[] = h1.map((v) => ({ t: v.t, mid: (Number(v.h) + Number(v.l)) / 2, h: Number(v.h), l: Number(v.l) }));

/** EMA 24 com seed SMA 24 (a mesma do #20). */
function emaSmaSeed(xs: number[], n = 24): (number | null)[] {
  const out: (number | null)[] = [];
  const k = 2 / (n + 1);
  let e: number | null = null;
  for (let i = 0; i < xs.length; i++) {
    if (i < n - 1) { out.push(null); continue; }
    if (i === n - 1) { e = xs.slice(0, n).reduce((a, b) => a + b, 0) / n; out.push(e); continue; }
    e = xs[i] * k + (e as number) * (1 - k);
    out.push(e);
  }
  return out;
}
const emaH1 = emaSmaSeed(H1.map((b) => (b.h + b.l) / 2), 24);

// ---------------------------------------------------------------- u e s (sem lookahead)
type P = { i: number; u: number; s: number };
const pontos: P[] = [];
let i1 = 0;
for (let i = 0; i < bars.length; i++) {
  if (i < L - 1) continue;
  let hi = -Infinity, lo = Infinity;
  for (let j = i - L + 1; j <= i; j++) {
    if (bars[j].h > hi) hi = bars[j].h;
    if (bars[j].l < lo) lo = bars[j].l;
  }
  const mid = bars[i].mid;
  const u = hi === lo ? 0.5 : Math.min(1, Math.max(0, (mid - lo) / (hi - lo)));
  while (i1 + 1 < H1.length && H1[i1 + 1].t + 3_600_000 <= bars[i].t) i1++;
  const ema = H1.length && H1[i1].t + 3_600_000 <= bars[i].t ? emaH1[i1] : null;
  const s = ema === null ? 0 : mid > ema ? 1 : mid < ema ? -1 : 0;
  pontos.push({ i, u, s });
}

// ---------------------------------------------------------------- flips e eventos
let sAnterior = 0;
const flips: { i: number; de: number; para: number; u: number; tipo: "long" | "short" }[] = [];
const desprezadosWarmup: number[] = [];
// todos os flips de `s` no PERIODO (para as contagens do §E e para o rótulo R2)
const todosFlips: number[] = [];
for (const p of pontos) {
  if (p.s !== 0 && p.s !== sAnterior) {
    // A maquina corre desde a primeira barra com `u` calculavel — inclusive no warmup — para
    // que "flip na faixa antes do warmup" seja CONTADO e o teste 1 possa reprovar.
    const tipo = avaliaFlip(p.s, sAnterior, p.u);
    if (p.i < L) {
      if (tipo !== null) desprezadosWarmup.push(p.i);
    } else {
      todosFlips.push(p.i);
      if (tipo !== null) flips.push({ i: p.i, de: sAnterior, para: p.s, u: p.u, tipo });
    }
  }
  if (p.s !== 0) sAnterior = p.s;
}

type Ev = {
  tipo: "long" | "short"; t_in: number; t_in_idx: number; mid_in: number; u_in: number; s_in: number;
  R1: Record<string, { h: number; mid_out: number | null; mov_bps: number | null }>;
  R2: { mid_out: number | null; mov_bps: number | null; ate_idx: number | null; barras: number | null };
};
const eventos: Ev[] = [];
for (const f of flips) {
  const R1: Ev["R1"] = {};
  for (const h of HORIZONTES) {
    const idx = f.i + h;
    const out = idx < bars.length ? bars[idx].mid : null;
    R1[`H${h}`] = { h, mid_out: out, mov_bps: out === null ? null : ((out - bars[f.i].mid) / bars[f.i].mid) * 10_000 };
  }
  const proximo = todosFlips.find((x) => x > f.i) ?? null;
  const out2 = proximo === null ? null : bars[proximo].mid;
  eventos.push({
    tipo: f.tipo as "long" | "short",
    t_in: bars[f.i].t, t_in_idx: f.i, mid_in: bars[f.i].mid, u_in: Number(f.u.toFixed(4)),
    s_in: f.para,
    R1,
    R2: {
      mid_out: out2,
      mov_bps: out2 === null ? null : ((out2 - bars[f.i].mid) / bars[f.i].mid) * 10_000,
      ate_idx: proximo,
      barras: proximo === null ? null : proximo - f.i,
    },
  });
}

// ---------------------------------------------------------------- etiquetas e leituras
const etiqueta = (tipo: "long" | "short", mov: number | null) => {
  if (mov === null) return null;
  if (Math.abs(mov) <= FLAT) return "sem_relacao" as const;
  const bem = tipo === "long" ? mov > 0 : mov < 0;
  return bem ? ("alinhou" as const) : ("inverteu" as const);
};
const med = (xs: number[]) => (xs.length ? Number(xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)].toFixed(1)) : null);
/** Menor k com P(X ≥ k) ≤ 0,05, X~Bin(n,0,5). O teste 6 confere-o contra a tabela publicada. */
function minBinomial(n: number, p = 0.05): number {
  const c = (a: number, b: number) => { let r = 1; for (let i = 0; i < b; i++) r = (r * (a - i)) / (i + 1); return r; };
  const total = 2 ** n;
  for (let k = 0; k <= n; k++) {
    let cauda = 0;
    for (let j = k; j <= n; j++) cauda += c(n, j);
    if (cauda / total <= p) return k;
  }
  return Infinity;
}
const TABELA: Record<number, number> = { 12: 10, 13: 10, 16: 12, 24: 17, 36: 24 };

function bloco(nome: string, movDe: (e: Ev) => number | null) {
  const abertos = eventos.filter((e) => movDe(e) === null).length;
  const fechados = eventos.filter((e) => movDe(e) !== null);
  const eleg = fechados.filter((e) => Math.abs(movDe(e) as number) > FLAT);
  const al = eleg.filter((e) => etiqueta(e.tipo, movDe(e)) === "alinhou").length;
  const inv = eleg.filter((e) => etiqueta(e.tipo, movDe(e)) === "inverteu").length;
  const n = al + inv;
  const minima = TABELA[n] ?? (n >= 12 ? minBinomial(n) : null);
  const soLong = eleg.filter((e) => e.tipo === "long").length;
  const soShort = eleg.filter((e) => e.tipo === "short").length;
  let veredicto: string;
  if (n < 12) veredicto = "insuficiente";
  else if (soLong === 0 || soShort === 0) veredicto = "amostra_enviesada";
  else veredicto = al >= (minima as number) ? "PASS" : "FAIL";
  return {
    leitura: nome, n_eventos_fechados: fechados.length, n_long: soLong, n_short: soShort,
    elegiveis: n, alinhou: al, inverteu: inv, razao: n ? Number((al / n).toFixed(3)) : null,
    mediana_mov_long: med(eleg.filter((e) => e.tipo === "long").map((e) => movDe(e) as number)),
    mediana_mov_short: med(eleg.filter((e) => e.tipo === "short").map((e) => movDe(e) as number)),
    n_abertos: abertos, minimo_binomial: minima, veredicto,
    _ets: fechados.map((e) => etiqueta(e.tipo, movDe(e))),
  };
}
const blocos: Record<string, ReturnType<typeof bloco>> = {};
for (const h of HORIZONTES) blocos[`R1_H${h}`] = bloco(`R1 holding ${h} barras`, (e) => e.R1[`H${h}`].mov_bps);
blocos.R2 = bloco("R2 ate ao proximo flip de s", (e) => e.R2.mov_bps);

// ---------------------------------------------------------------- testes (§G)
const testes: { nome: string; ok: boolean; detalhe: string }[] = [];
testes.push({
  nome: "1. warmup sem eventos",
  // A asserção é sobre os EVENTOS (o que a leitura usa). Os flips-na-faixa que caiam no warmup
  // sao descartados e apenas contados: isso e comportamento previsto, nao falha.
  ok: eventos.every((e) => e.t_in_idx >= L),
  detalhe: `primeiro evento em i=${eventos.length ? Math.min(...eventos.map((e) => e.t_in_idx)) : "-"} (L=${L}) · ${desprezadosWarmup.length} flips-na-faixa descartados no warmup`,
});
testes.push({ nome: "2. flip com u=0,50 nao entra", ok: avaliaFlip(1, -1, 0.5) === null && avaliaFlip(-1, 1, 0.5) === null, detalhe: "flip no meio do canal" });
testes.push({ nome: "3. +1 com u=0,20 entra long; -1 com u=0,80 entra short", ok: avaliaFlip(1, -1, 0.2) === "long" && avaliaFlip(-1, 1, 0.8) === "short", detalhe: `${avaliaFlip(1, -1, 0.2)} / ${avaliaFlip(-1, 1, 0.8)}` });
testes.push({ nome: "4. +1 com u=0,80 nao entra", ok: avaliaFlip(1, -1, 0.8) === null, detalhe: "long no tecto nao existe" });
{
  const idx = eventos.map((e) => e.t_in_idx);
  const distintos = new Set(idx).size === idx.length;
  const dentro = eventos.every((e) => (e.tipo === "long" ? e.u_in <= CHAO : e.u_in >= TECTO));
  const sCoerente = eventos.every((e) => (e.tipo === "long" ? e.s_in === 1 : e.s_in === -1));
  testes.push({ nome: "5. dois flips na faixa = duas linhas; sem duplicados", ok: distintos && dentro && sCoerente, detalhe: `${idx.length} eventos, ${new Set(idx).size} indices distintos, banda e s coerentes: ${dentro && sCoerente}` });
}
{
  const difs = Object.entries(TABELA).filter(([n, k]) => Number.isFinite(minBinomial(Number(n))) && minBinomial(Number(n)) !== k);
  testes.push({ nome: "6. binomial 12->10, 13->10, 16->12, 24->17, 36->24", ok: difs.length === 0, detalhe: difs.length ? JSON.stringify(difs) : "conferidos" });
}
{
  const somaOk = HORIZONTES.every((h) => (blocos[`R1_H${h}`] as { _ets: unknown[] })._ets.length === blocos[`R1_H${h}`].n_eventos_fechados)
    && (blocos.R2 as { _ets: unknown[] })._ets.length === blocos.R2.n_eventos_fechados;
  testes.push({ nome: "7. alinhou+inverteu+sem_relacao = fechados", ok: somaOk, detalhe: "R1 x3 e R2 conferidos" });
}
console.log();
console.log("== TESTES (§G, antes da leitura) ==");
for (const t of testes) console.log(`  [${t.ok ? "OK  " : "FALHA"}] ${t.nome} — ${t.detalhe}`);
if (testes.some((t) => !t.ok) && !process.argv.includes("--sem-teste")) {
  console.log("\n  Ha teste a falhar: a leitura nao se publica.");
  process.exit(1);
}

// ---------------------------------------------------------------- contagens extra (§E)
const nFlips = todosFlips.length;
const nNaFaixa = eventos.length;
const nMeio = nFlips - nNaFaixa;
const pctFaixa = nFlips ? Number(((100 * nNaFaixa) / nFlips).toFixed(1)) : 0;
console.log();
console.log("== CONTAGENS (§E) ==");
console.log(`  flips totais de s no periodo: ${nFlips}`);
console.log(`  flips NA FAIXA (eventos):     ${nNaFaixa}`);
console.log(`  flips no meio (descartados):  ${nMeio}`);
console.log(`  % na faixa:                   ${pctFaixa} %${pctFaixa < 1 ? "  => insuficiente por construcao: a regra nao dispara neste livro" : ""}`);

const sha = createHash("sha256").update(readFileSync(cacheUsada)).digest("hex").slice(0, 16);
let commit = "?";
try { commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); } catch { /* fora do repo */ }
const meta = {
  venue: "hyperliquid-testnet", coin: COIN, cache: cacheUsada, barras: vs.length,
  pedidas_solicitadas: PEDIDAS, barras_recebidas: vs.length, truncada: vs.length < PEDIDAS * 0.9,
  primeira_iso: new Date(vs[0].t).toISOString(), ultima_iso: new Date(vs[vs.length - 1].t).toISOString(),
  L, CHAO, TECTO, FLAT, horizontes_barras: HORIZONTES, sha_serie: sha, commit, gerado_em: new Date().toISOString(),
  regra: "evento = s muda de sinal E (u<=CHAO para long) ou (u>=TECTO para short); toque sem flip nao entra",
};
writeFileSync(`${DIR}/meta.json`, JSON.stringify(meta, null, 1));
writeFileSync(`${DIR}/eventos.json`, JSON.stringify(eventos.map((e) => ({
  tipo: e.tipo, t_in: e.t_in, t_in_iso: new Date(e.t_in).toISOString(), mid_in: e.mid_in, u_in: e.u_in, s_in: e.s_in,
  R1: Object.fromEntries(HORIZONTES.map((h) => [`H${h}`, { ...e.R1[`H${h}`], etiqueta: etiqueta(e.tipo, e.R1[`H${h}`].mov_bps) }])),
  R2: { ...e.R2, etiqueta: etiqueta(e.tipo, e.R2.mov_bps) },
})), null, 1));
writeFileSync(`${DIR}/resumo.json`, JSON.stringify({ contagens: { flips_totais: nFlips, na_faixa: nNaFaixa, no_meio: nMeio, pct_faixa: pctFaixa }, blocos }, null, 1));

const L2: string[] = [];
L2.push("# Ensaio flip-na-faixa — entrada só no flip dentro da faixa do extremo");
L2.push("");
L2.push(`Fonte: ${meta.venue} ${COIN} · ${meta.barras} barras de 5 min (pedidas ${PEDIDAS}${meta.truncada ? " — a fonte dá menos: ~17,5 dias" : ""})`);
L2.push(`Janela: ${meta.primeira_iso} → ${meta.ultima_iso} · série \`${sha}\` · commit \`${commit}\``);
L2.push(`L=${L} · CHAO=${CHAO} · TECTO=${TECTO} · FLAT=${FLAT} bps · R1 12/36/72 barras · R2 até o próximo flip`);
L2.push("");
L2.push(`Regra de entrada: **flip de \`s\` na faixa** — \`u ≤ ${CHAO}\` e flip para \`+1\` → long; \`u ≥ ${TECTO}\` e flip para \`−1\` → short. Toque no extremo **sem** flip não é evento; flip no meio do canal não é evento.`);
L2.push("");
L2.push("| contagem | |");
L2.push("|---|---|");
L2.push(`| flips totais de \`s\` | ${nFlips} |`);
L2.push(`| flips **na faixa** (eventos) | ${nNaFaixa} |`);
L2.push(`| flips no meio (descartados) | ${nMeio} |`);
L2.push(`| % na faixa | **${pctFaixa} %** |`);
L2.push("");
L2.push("| leitura | fechados | long/short | elegíveis | alinhou | inverteu | razão | med long (bps) | med short (bps) | abertos | mínimo k/n | veredicto |");
L2.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const k of [...HORIZONTES.map((h) => `R1_H${h}`), "R2"]) {
  const b = blocos[k];
  L2.push(`| **${b.leitura}** | ${b.n_eventos_fechados} | ${b.n_long}/${b.n_short} | ${b.elegiveis} | ${b.alinhou} | ${b.inverteu} | ${b.razao ?? "—"} | ${b.mediana_mov_long ?? "—"} | ${b.mediana_mov_short ?? "—"} | ${b.n_abertos} | ${b.minimo_binomial ?? "—"} | **${b.veredicto}** |`);
}
L2.push("");
L2.push("R1 e R2 **não** se somam: são dois rótulos sobre os mesmos eventos. Nada aqui é PnL — sem fill, sem taxa, sem signer.");
writeFileSync(`${DIR}/RESUMO.md`, `${L2.join("\n")}\n`);

console.log();
console.log("== RESUMO ==");
for (const k of [...HORIZONTES.map((h) => `R1_H${h}`), "R2"]) {
  const b = blocos[k];
  console.log(`  ${b.leitura}: fechados ${b.n_eventos_fechados} (long ${b.n_long}/short ${b.n_short}) · elegiveis ${b.elegiveis} · alinhou ${b.alinhou}/inverteu ${b.inverteu} · razao ${b.razao ?? "-"} · minimo ${b.minimo_binomial ?? "-"} · ${b.veredicto} · abertos ${b.n_abertos}`);
}
console.log();
console.log(`  artefactos: ${DIR}/meta.json · eventos.json · resumo.json · RESUMO.md`);
