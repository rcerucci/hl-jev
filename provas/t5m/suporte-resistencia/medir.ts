#!/usr/bin/env bun
/**
 * Ensaio **suporte / resistência com o `s` a favor** (regra do dono, 25 set 2026).
 *
 * Na faixa do extremo, abrir de acordo com o `s`:
 *
 *     u ≤ CHAO  (0,25) e s = +1  → LONG      // suporte, tendência de alta: seguir o `s` para long
 *     u ≥ TECTO (0,75) e s = −1  → SHORT     // resistência, tendência de baixa: seguir o `s` para short
 *     tudo o resto               → não evento
 *
 * **Interpretação congelada antes de correr** (o texto do dono não diz a unidade, digo-a eu):
 *  - evento = **período contínuo** em que a condição vale. Abre na **primeira** barra em que passa a
 *    valer (vinda de fora) e fecha na barra em que deixa de valer — bandas e `s` no mesmo critério.
 *  - logo `t_in` = a primeira barra do período, e **uma linha por período** (não uma por barra).
 *  - `R1` = holding fixo 12/36/72 barras (comparável com o #20/#23); `R2` = até a condição **acabar**
 *    (é a saída natural desta regra: sai quando o suporte/`s` deixa de valer).
 *  - `FLAT = 10 bps`; elegível = fechado e `|mov| > FLAT`; binomial igual ao N1.
 *
 * Sobreposição a declarar: o canto "extremo com `s` a favor" é o **E1 do #20** (lá com entrada no
 * *toque*, aqui com entrada no começo do *período* em que a condição vale). O #20 deu E1 = 8/12 no H36
 * (FAIL). Este ensaio muda a unidade de entrada e acrescenta a saída própria em R2.
 *
 * Uso: bun run provas/t5m/suporte-resistencia/medir.ts [--sem-teste]
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
const DIR = "provas/t5m/suporte-resistencia";
const CACHES = ["provas/t5m/velas-5m.json", "provas/t5m/extremos/velas-5m.json", "provas/t5m/flip-faixa/../extremos/velas-5m.json"];

/** A regra, isolada: `null` = não evento. */
export function avaliaFaixa(u: number, s: number, chao = CHAO, tecto = TECTO): "long" | "short" | null {
  if (u <= chao && s === 1) return "long";   // suporte com tendência de alta
  if (u >= tecto && s === -1) return "short"; // resistência com tendência de baixa
  return null;
}

// ---------------------------------------------------------------- fonte
let vs: Vela[] | null = null;
let cacheUsada = "";
for (const c of CACHES) {
  if (existsSync(c)) { vs = JSON.parse(readFileSync(c, "utf8")) as Vela[]; cacheUsada = c; break; }
}
if (!vs) {
  vs = await velas(COIN, "5m", Date.now() - 20 * 24 * 3_600_000, Date.now(), 300_000);
  cacheUsada = CACHES[0];
  writeFileSync(cacheUsada, JSON.stringify(vs));
}
const PEDIDAS = 5760;
console.log("== FONTE ==");
console.log(`  cache: ${cacheUsada} (${vs.length} barras) — a serie usada e esta, byte a byte`);
if (vs.length < PEDIDAS * 0.9) {
  console.log(`  AVISO: a fonte de 5 min deste venue acaba em ~${vs.length} barras (~17,5 d); pedir 20 dias devolve o mesmo.`);
}

const h1: Vela[] = await velas(COIN, "1h", vs[0].t - 30 * 3_600_000, Date.now(), 3_600_000);

type Bar = { t: number; mid: number; h: number; l: number };
const bars: Bar[] = vs.map((v) => ({ t: v.t, mid: (Number(v.h) + Number(v.l)) / 2, h: Number(v.h), l: Number(v.l) }));
const H1: Bar[] = h1.map((v) => ({ t: v.t, mid: (Number(v.h) + Number(v.l)) / 2, h: Number(v.h), l: Number(v.l) }));

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

type P = { i: number; u: number; s: number; horaFechadaOk: boolean };
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
  const ok = H1.length > 0 && H1[i1].t + 3_600_000 <= bars[i].t;
  const ema = ok ? emaH1[i1] : null;
  const s = ema === null ? 0 : mid > ema ? 1 : mid < ema ? -1 : 0;
  pontos.push({ i, u, s, horaFechadaOk: ok });
}
const porIdx = new Map<number, P>(pontos.map((p) => [p.i, p]));

// ---------------------------------------------------------------- periodos = eventos
type Ev = {
  tipo: "long" | "short"; t_in: number; t_in_idx: number; mid_in: number; u_in: number; s_in: number;
  R1: Record<string, { h: number; mid_out: number | null; mov_bps: number | null }>;
  R2: { mid_out: number | null; mov_bps: number | null; ate_idx: number | null; barras: number | null; abertura_fora_warmup: boolean };
};
const eventos: Ev[] = [];
const descartadosWarmup: number[] = [];
const condDe = (p: P) => avaliaFaixa(p.u, p.s);
let aberto: { tipo: "long" | "short"; i: number } | null = null;

function fecha(idx: number, tipo: "long" | "short", i0: number) {
  const R1: Ev["R1"] = {};
  for (const h of HORIZONTES) {
    const idxF = i0 + h;
    const out = idxF < bars.length ? bars[idxF].mid : null;
    R1[`H${h}`] = { h, mid_out: out, mov_bps: out === null ? null : ((out - bars[i0].mid) / bars[i0].mid) * 10_000 };
  }
  const out2 = idx < bars.length ? bars[idx].mid : null;
  eventos.push({
    tipo, t_in: bars[i0].t, t_in_idx: i0, mid_in: bars[i0].mid,
    u_in: Number((porIdx.get(i0)?.u ?? 0).toFixed(4)), s_in: porIdx.get(i0)?.s ?? 0,
    R1,
    R2: {
      mid_out: out2,
      mov_bps: out2 === null ? null : ((out2 - bars[i0].mid) / bars[i0].mid) * 10_000,
      ate_idx: idx < bars.length ? idx : null,
      barras: idx < bars.length ? idx - i0 : null,
      abertura_fora_warmup: i0 >= L,
    },
  });
}

// Bloqueio do warmup: um periodo que NASCE antes de L nao entra — nem a continuacao dele. Enquanto a
// mesma condicao continuar, nada abre; quando muda de tipo ou acaba, desbloqueia.
let tipoBloqueado: "long" | "short" | null = null;
for (const p of pontos) {
  const cond = condDe(p);
  if (aberto && cond !== aberto.tipo) {
    fecha(p.i, aberto.tipo, aberto.i); // saiu da condicao nesta barra
    aberto = null;
  }
  if (cond !== tipoBloqueado) tipoBloqueado = null;
  if (cond === null || aberto) continue;
  if (p.i < L) {
    tipoBloqueado = cond;
    descartadosWarmup.push(p.i);
    continue;
  }
  if (tipoBloqueado !== null) continue; // continuacao de um periodo nascido no warmup: nao abre
  aberto = { tipo: cond, i: p.i };
}
// periodo que nunca fechou: R2 aberto, R1 conforme o horizonte
if (aberto) fecha(bars.length, aberto.tipo, aberto.i);

// ---------------------------------------------------------------- etiquetas
const etiqueta = (tipo: "long" | "short", mov: number | null) => {
  if (mov === null) return null;
  if (Math.abs(mov) <= FLAT) return "sem_relacao" as const;
  const bem = tipo === "long" ? mov > 0 : mov < 0;
  return bem ? ("alinhou" as const) : ("inverteu" as const);
};
const med = (xs: number[]) => (xs.length ? Number(xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)].toFixed(1)) : null);
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
  const fechados = eventos.filter((e) => movDe(e) !== null);
  const eleg = fechados.filter((e) => Math.abs(movDe(e) as number) > FLAT);
  const al = eleg.filter((e) => etiqueta(e.tipo, movDe(e)) === "alinhou").length;
  const inv = eleg.filter((e) => etiqueta(e.tipo, movDe(e)) === "inverteu").length;
  const n = al + inv;
  const minima = TABELA[n] ?? (n >= 12 ? minBinomial(n) : null);
  const nLong = eleg.filter((e) => e.tipo === "long").length;
  const nShort = eleg.filter((e) => e.tipo === "short").length;
  let veredicto: string;
  if (n < 12) veredicto = "insuficiente";
  else if (nLong === 0 || nShort === 0) veredicto = "amostra_enviesada";
  else veredicto = al >= (minima as number) ? "PASS" : "FAIL";
  return {
    leitura: nome, n_eventos_fechados: fechados.length, n_long: nLong, n_short: nShort,
    elegiveis: n, alinhou: al, inverteu: inv, razao: n ? Number((al / n).toFixed(3)) : null,
    mediana_mov_long: med(eleg.filter((e) => e.tipo === "long").map((e) => movDe(e) as number)),
    mediana_mov_short: med(eleg.filter((e) => e.tipo === "short").map((e) => movDe(e) as number)),
    n_abertos: eventos.filter((e) => movDe(e) === null).length,
    minimo_binomial: minima, veredicto,
    _ets: fechados.map((e) => etiqueta(e.tipo, movDe(e))),
    _fechados: fechados,
  };
}
const blocos: Record<string, ReturnType<typeof bloco>> = {};
for (const h of HORIZONTES) blocos[`R1_H${h}`] = bloco(`R1 holding ${h} barras`, (e) => e.R1[`H${h}`].mov_bps);
blocos.R2 = bloco("R2 ate a condicao acabar", (e) => e.R2.mov_bps);

// ---------------------------------------------------------------- testes
const testes: { nome: string; ok: boolean; detalhe: string }[] = [];
testes.push({
  nome: "1. regra: suporte+s=+1 entra long; resistencia+s=-1 entra short; resto nada",
  ok: avaliaFaixa(0.2, 1) === "long" && avaliaFaixa(0.2, -1) === null && avaliaFaixa(0.8, -1) === "short" && avaliaFaixa(0.8, 1) === null && avaliaFaixa(0.5, 1) === null,
  detalhe: `long ${avaliaFaixa(0.2, 1)} · suporte com s=-1 ${avaliaFaixa(0.2, -1)} · short ${avaliaFaixa(0.8, -1)} · tecto com s=+1 ${avaliaFaixa(0.8, 1)} · meio ${avaliaFaixa(0.5, 1)}`,
});
testes.push({ nome: "2. warmup sem eventos", ok: eventos.every((e) => e.t_in_idx >= L), detalhe: `primeiro em i=${eventos.length ? Math.min(...eventos.map((e) => e.t_in_idx)) : "-"} (L=${L}) · ${descartadosWarmup.length} periodos descartados` });
{
  // A barra ANTERIOR a cada abertura nao pode satisfazer a MESMA condicao: senao uma visita valia N linhas.
  const viol = eventos.filter((e) => { const a = porIdx.get(e.t_in_idx - 1); return a ? condDe(a) === e.tipo : false; }).length;
  testes.push({ nome: "3. um periodo = uma linha", ok: viol === 0, detalhe: `${viol} eventos com a barra anterior na mesma condicao` });
}
{
  const viol = eventos.filter((e) => { const a = porIdx.get(e.t_in_idx); return !a || condDe(a) !== e.tipo; }).length;
  testes.push({ nome: "4. a abertura satisfaz a condicao do seu tipo", ok: viol === 0, detalhe: `${viol} aberturas sem condicao` });
}
{
  // R2: todas as barras de t_in ate ate_idx-1 satisfazem a condicao; a de ate_idx nao.
  let viol = 0, conferidos = 0;
  for (const e of eventos) {
    if (e.R2.ate_idx === null) continue;
    conferidos++;
    for (let i = e.t_in_idx; i < e.R2.ate_idx; i++) if (porIdx.get(i) && condDe(porIdx.get(i) as P) !== e.tipo) viol++;
    const fora = porIdx.get(e.R2.ate_idx);
    if (fora && condDe(fora) === e.tipo) viol++;
  }
  testes.push({ nome: "5. R2 fecha exactamente na saida da condicao", ok: viol === 0, detalhe: `${conferidos} periodos conferidos, ${viol} desvios` });
}
{
  const somaOk = HORIZONTES.every((h) => (blocos[`R1_H${h}`] as { _ets: unknown[] })._ets.length === blocos[`R1_H${h}`].n_eventos_fechados)
    && (blocos.R2 as { _ets: unknown[] })._ets.length === blocos.R2.n_eventos_fechados;
  testes.push({ nome: "6. alinhou+inverteu+sem_relacao = fechados", ok: somaOk, detalhe: "R1 x3 e R2 conferidos" });
}
{
  const difs = Object.entries(TABELA).filter(([n, k]) => minBinomial(Number(n)) !== k);
  testes.push({ nome: "7. binomial 12->10, 13->10, 16->12, 24->17, 36->24", ok: difs.length === 0, detalhe: difs.length ? JSON.stringify(difs) : "conferidos" });
}
console.log();
console.log("== TESTES (antes da leitura) ==");
for (const t of testes) console.log(`  [${t.ok ? "OK  " : "FALHA"}] ${t.nome} — ${t.detalhe}`);
if (testes.some((t) => !t.ok) && !process.argv.includes("--sem-teste")) {
  console.log("\n  Ha teste a falhar: a leitura nao se publica.");
  process.exit(1);
}

// ---------------------------------------------------------------- contagens de disparo
const nBarrasLong = pontos.filter((p) => p.i >= L && p.u <= CHAO && p.s === 1).length;
const nBarrasShort = pontos.filter((p) => p.i >= L && p.u >= TECTO && p.s === -1).length;
console.log();
console.log("== QUANTO DISPARA ==");
console.log(`  barras na condicao long (suporte + s=+1):  ${nBarrasLong} de ${pontos.filter((p) => p.i >= L).length}`);
console.log(`  barras na condicao short (tecto + s=-1):  ${nBarrasShort}`);
console.log(`  periodos (eventos): ${eventos.length}  · descartados no warmup: ${descartadosWarmup.length}`);

const sha = createHash("sha256").update(readFileSync(cacheUsada)).digest("hex").slice(0, 16);
let commit = "?";
try { commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); } catch { /* fora do repo */ }
const meta = {
  venue: "hyperliquid-testnet", coin: COIN, cache: cacheUsada, barras: vs.length,
  pedidas_solicitadas: PEDIDAS, barras_recebidas: vs.length, truncada: vs.length < PEDIDAS * 0.9,
  primeira_iso: new Date(vs[0].t).toISOString(), ultima_iso: new Date(vs[vs.length - 1].t).toISOString(),
  L, CHAO, TECTO, FLAT, horizontes_barras: HORIZONTES, sha_serie: sha, commit, gerado_em: new Date().toISOString(),
  regra: "suporte (u<=0,25) com s=+1 -> long; resistencia (u>=0,75) com s=-1 -> short; evento = periodo continuo, t_in na primeira barra",
  interpretacao: "unidade = periodo continuo da condicao; R2 = saida quando a condicao acaba; FLAT=10 bps",
};
writeFileSync(`${DIR}/meta.json`, JSON.stringify(meta, null, 1));
writeFileSync(`${DIR}/eventos.json`, JSON.stringify(eventos.map((e) => ({
  tipo: e.tipo, t_in: e.t_in, t_in_iso: new Date(e.t_in).toISOString(), mid_in: e.mid_in, u_in: e.u_in, s_in: e.s_in,
  R1: Object.fromEntries(HORIZONTES.map((h) => [`H${h}`, { ...e.R1[`H${h}`], etiqueta: etiqueta(e.tipo, e.R1[`H${h}`].mov_bps) }])),
  R2: { ...e.R2, etiqueta: etiqueta(e.tipo, e.R2.mov_bps) },
})), null, 1));
writeFileSync(`${DIR}/resumo.json`, JSON.stringify({ contagens: { barras_long: nBarrasLong, barras_short: nBarrasShort, periodos: eventos.length, descartados_warmup: descartadosWarmup.length }, blocos }, null, 1));

const l: string[] = [];
l.push("# Ensaio suporte/resistência com o `s` a favor");
l.push("");
l.push(`Fonte: ${meta.venue} ${COIN} · ${meta.barras} barras de 5 min (pedidas ${PEDIDAS}${meta.truncada ? " — a fonte dá menos: ~17,5 dias" : ""})`);
l.push(`Janela: ${meta.primeira_iso} → ${meta.ultima_iso} · série \`${sha}\` · commit \`${commit}\``);
l.push(`L=${L} · CHAO=${CHAO} · TECTO=${TECTO} · FLAT=${FLAT} bps · R1 12/36/72 barras · R2 até a condição acabar`);
l.push("");
l.push(`Regra: **na faixa, seguir o \`s\`** — \`u ≤ ${CHAO}\` (suporte) com \`s = +1\` → long; \`u ≥ ${TECTO}\` (resistência) com \`s = −1\` → short. Fora disso não há evento.`);
l.push("");
l.push("| quanto dispara | |");
l.push("|---|---|");
l.push(`| barras na condição long | ${nBarrasLong} |`);
l.push(`| barras na condição short | ${nBarrasShort} |`);
l.push(`| **períodos (eventos)** | **${eventos.length}** |`);
l.push(`| períodos descartados no warmup | ${descartadosWarmup.length} |`);
l.push("");
l.push("| leitura | fechados | long/short | elegíveis | alinhou | inverteu | razão | med long (bps) | med short (bps) | abertos | mínimo k/n | veredicto |");
l.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const k of [...HORIZONTES.map((h) => `R1_H${h}`), "R2"]) {
  const b = blocos[k];
  l.push(`| **${b.leitura}** | ${b.n_eventos_fechados} | ${b.n_long}/${b.n_short} | ${b.elegiveis} | ${b.alinhou} | ${b.inverteu} | ${b.razao ?? "—"} | ${b.mediana_mov_long ?? "—"} | ${b.mediana_mov_short ?? "—"} | ${b.n_abertos} | ${b.minimo_binomial ?? "—"} | **${b.veredicto}** |`);
}
l.push("");
l.push("R1 e R2 **não** se somam. Nada aqui é PnL — sem fill, sem taxa, sem signer.");
writeFileSync(`${DIR}/RESUMO.md`, `${l.join("\n")}\n`);

console.log();
console.log("== RESUMO ==");
for (const k of [...HORIZONTES.map((h) => `R1_H${h}`), "R2"]) {
  const b = blocos[k];
  console.log(`  ${b.leitura}: fechados ${b.n_eventos_fechados} (long ${b.n_long}/short ${b.n_short}) · elegiveis ${b.elegiveis} · alinhou ${b.alinhou}/inverteu ${b.inverteu} · razao ${b.razao ?? "-"} · minimo ${b.minimo_binomial ?? "-"} · ${b.veredicto} · abertos ${b.n_abertos}`);
}
console.log();
console.log(`  artefactos: ${DIR}/meta.json · eventos.json · resumo.json · RESUMO.md`);
