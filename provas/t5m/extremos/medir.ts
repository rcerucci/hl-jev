#!/usr/bin/env bun
/**
 * Ensaio dos extremos — "short no tecto, long no chão", horizonte **fixo**.
 *
 * Zero produto: não toca em `src/`, não arranca motor, não há signer, nem worker 300/900 s.
 * Corre só sobre a série pública paginada (`provas/t5m/velas.ts`).
 *
 * Definições pinadas (não se afinam depois de ver a tabela):
 *   mid[i] = (h+l)/2 ; hi/lo = extremos das últimas L=130 barras ; u = clip((mid-lo)/(hi-lo),0,1)
 *   EMA_P[H1] = EMA(hl2_H1, 24) com **seed SMA 24**, só H1 fechada (close_ts ≤ open_ts(i))
 *   s[i] = sinal de mid[i] contra EMA_P ; visita abre no primeiro u ≤ CHAO (chão) ou ≥ TECTO
 *   (tecto) **depois de** ter estado fora da zona; uma visita = uma linha, t_in = primeira barra
 *   horizontes fixos: 12 / 36 / 72 barras ; FLAT = 10 bps
 *
 * Leituras no mesmo banco: E0 = todos os toques; E1 = toque com `s` a favor; E2 = toque com `s`
 * contra. `s = 0` conta em E0 e em nenhum dos outros.
 *
 * Uso: bun run provas/t5m/extremos/medir.ts [--sem-teste]
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { provarFonte, serie, velas, type Vela } from "../velas";

const L = 130;
const CHAO = 0.15;
const TECTO = 0.85;
const FLAT = 10;
const HORIZONTES = [12, 36, 72] as const;
const COIN = "BTC";
const DIR = "provas/t5m/extremos";
const CACHE = `${DIR}/velas-5m.json`;
const HORAS = 24 * 20; // pedido: 20 dias; a fonte entrega o que tiver (hoje ~17,5)

// ---------------------------------------------------------------- fonte
let vs: Vela[];
let pedidas: number;
if (existsSync(CACHE)) {
  vs = JSON.parse(readFileSync(CACHE, "utf8")) as Vela[];
  pedidas = vs.length;
  console.log("== FONTE ==");
  console.log(`  cache em disco: ${CACHE} (${vs.length} barras) — a serie usada e esta, byte a byte`);
} else {
  const s = await serie(COIN, HORAS, 300_000);
  vs = s.velas;
  pedidas = s.pedidas;
  provarFonte(vs, pedidas);
  writeFileSync(CACHE, JSON.stringify(vs));
  console.log(`  cache gravada em ${CACHE}`);
}

const agora = Date.now();
const h1: Vela[] = await velas(COIN, "1h", vs[0].t - 30 * 3_600_000, agora, 3_600_000);

type Bar = { t: number; T: number; mid: number; h: number; l: number };
const bars: Bar[] = vs.map((v) => ({ t: v.t, T: v.T, mid: (Number(v.h) + Number(v.l)) / 2, h: Number(v.h), l: Number(v.l) }));
const H1: Bar[] = h1.map((v) => ({ t: v.t, T: v.T, mid: (Number(v.h) + Number(v.l)) / 2, h: Number(v.h), l: Number(v.l) }));

// ---------------------------------------------------------------- EMA com seed SMA 24
function emaSmaSeed(xs: number[], n = 24): (number | null)[] {
  const out: (number | null)[] = [];
  const k = 2 / (n + 1);
  let e: number | null = null;
  for (let i = 0; i < xs.length; i++) {
    if (i < n - 1) { out.push(null); continue; }
    if (i === n - 1) { e = xs.slice(0, n).reduce((a, b) => a + b, 0) / n; out.push(e); continue; }
    e = (xs[i] * k + (e as number) * (1 - k));
    out.push(e);
  }
  return out;
}
const emaH1 = emaSmaSeed(H1.map((b) => (b.h + b.l) / 2), 24);

// ---------------------------------------------------------------- u e s por barra
type Ponto = { i: number; u: number; s: number; h1Idx: number };
const pontos: Ponto[] = [];
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
  // ultima H1 com close_ts <= open_ts(i): nunca a hora a formar
  while (i1 + 1 < H1.length && H1[i1 + 1].T <= bars[i].t) i1++;
  const ema = H1.length && H1[i1].T <= bars[i].t ? emaH1[i1] : null;
  const s = ema === null ? 0 : mid > ema ? 1 : mid < ema ? -1 : 0;
  pontos.push({ i, u, s, h1Idx: i1 });
}

// ---------------------------------------------------------------- eventos = visitas
type Ev = {
  tipo: "chao" | "tecto";
  t_in: number; t_in_idx: number;
  mid_in: number; u_in: number; s_in: number;
  h: Record<string, { horizonte_bars: number; mid_out: number | null; mov_bps: number | null }>;
};
const eventos: Ev[] = [];
// `armado` = ja esteve FORA da zona desde a ultima visita. Comeca em `false`: a primeira
// visita exige ter visto `u` fora da zona primeiro ("depois de u > CHAO", §D).
let armadoChao = false, emChao = false;
let armadoTecto = false, emTecto = false;
const uPorIdx = new Map<number, number>(pontos.map((p) => [p.i, p.u]));
const desprezadosWarmup: number[] = [];
for (const p of pontos) {
  if (emChao && p.u > CHAO) emChao = false;
  if (emTecto && p.u < TECTO) emTecto = false;
  if (!emChao && p.u > CHAO) armadoChao = true;
  if (!emTecto && p.u < TECTO) armadoTecto = true;
  const abreChao = !emChao && armadoChao && p.u <= CHAO;
  const abreTecto = !emTecto && armadoTecto && p.u >= TECTO;
  if (!abreChao && !abreTecto) continue;
  if (abreChao) { emChao = true; armadoChao = false; }
  if (abreTecto) { emTecto = true; armadoTecto = false; }
  // Warmup do §B: 24 H1 + L barras ANTES do primeiro evento. Visita que abra antes disso
  // nao entra — e fica contada, para o teste 1 poder reprovar.
  if (p.i < L) { desprezadosWarmup.push(p.i); continue; }
  const hs: Ev["h"] = {};
  for (const hz of HORIZONTES) {
    const idx = p.i + hz;
    const out = idx < bars.length ? bars[idx].mid : null;
    hs[`H${hz}`] = {
      horizonte_bars: hz,
      mid_out: out,
      mov_bps: out === null ? null : ((out - bars[p.i].mid) / bars[p.i].mid) * 10_000,
    };
  }
  eventos.push({ tipo: abreChao ? "chao" : "tecto", t_in: bars[p.i].t, t_in_idx: p.i, mid_in: bars[p.i].mid, u_in: p.u, s_in: p.s, h: hs });
}

// ---------------------------------------------------------------- etiquetas e resumo
const etiqueta = (tipo: Ev["tipo"], mov: number | null): "alinhou" | "inverteu" | "sem_relacao" | null => {
  if (mov === null) return null;
  if (Math.abs(mov) <= FLAT) return "sem_relacao";
  const long = tipo === "chao";
  if (long) return mov > 0 ? "alinhou" : "inverteu";
  return mov < 0 ? "alinhou" : "inverteu";
};
const med = (xs: number[]) =>
  xs.length ? Number(xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)].toFixed(1)) : null;
/**
 * Menor k tal que P(X ≥ k) ≤ p, com X ~ Binomial(n, 0,5) — o mínimo k/n do §H. A cauda
 * DESCE com k, logo procura-se o primeiro k (de baixo para cima) cuja cauda já cabe em p.
 * (Uma primeira versão disto procurava de cima para baixo e devolvia sempre `n`; o teste 6
 * foi escrito para o apanhar e apanhou-o.)
 */
function minBinomial(n: number, p = 0.05): number {
  const c = (a: number, b: number) => { let r = 1; for (let i = 0; i < b; i++) r = (r * (a - i)) / (i + 1); return r; };
  const total = 2 ** n;
  for (let k = 0; k <= n; k++) {
    let cauda = 0;
    for (let j = k; j <= n; j++) cauda += c(n, j);
    if (cauda / total <= p) return k;
  }
  return Infinity; // nem n/n chega ao limiar
}
const TABELA: Record<number, number> = { 12: 10, 13: 10, 16: 12, 24: 17, 36: 24 };

function ler(eventosF: Ev[], hz: number, filtro: "E0" | "E1" | "E2") {
  const usados = eventosF.filter((e) => {
    if (filtro === "E0") return true;
    if (e.s_in === 0) return false;
    const aFavor = (e.tipo === "chao" && e.s_in === 1) || (e.tipo === "tecto" && e.s_in === -1);
    return filtro === "E1" ? aFavor : !aFavor;
  });
  const abertos = usados.filter((e) => e.h[`H${hz}`].mov_bps === null).length;
  const fechados = usados.filter((e) => e.h[`H${hz}`].mov_bps !== null);
  const ets = fechados.map((e) => etiqueta(e.tipo, e.h[`H${hz}`].mov_bps)).filter((x) => x !== null) as string[];
  const eleg = fechados.filter((e) => Math.abs(e.h[`H${hz}`].mov_bps as number) > FLAT);
  const al = eleg.filter((e) => etiqueta(e.tipo, e.h[`H${hz}`].mov_bps) === "alinhou").length;
  const inv = eleg.filter((e) => etiqueta(e.tipo, e.h[`H${hz}`].mov_bps) === "inverteu").length;
  const movChao = eleg.filter((e) => e.tipo === "chao").map((e) => e.h[`H${hz}`].mov_bps as number);
  const movTecto = eleg.filter((e) => e.tipo === "tecto").map((e) => e.h[`H${hz}`].mov_bps as number);
  const n = al + inv;
  const minima = TABELA[n] ?? (n >= 12 ? minBinomial(n) : null);
  let veredicto: string;
  if (n < 12) veredicto = "insuficiente";
  else if (eleg.filter((e) => e.tipo === "chao").length === 0 || eleg.filter((e) => e.tipo === "tecto").length === 0) veredicto = "amostra_enviesada";
  else veredicto = al >= (minima as number) ? "PASS" : "FAIL";
  return {
    n_eventos_fechados: fechados.length,
    n_chao: fechados.filter((e) => e.tipo === "chao").length,
    n_tecto: fechados.filter((e) => e.tipo === "tecto").length,
    elegiveis: n,
    alinhou: al, inverteu: inv,
    razao: n ? al / n : null,
    mediana_mov_chao: med(movChao), mediana_mov_tecto: med(movTecto),
    n_abertos: abertos,
    minimo_binomial: minima,
    veredicto,
    _ets: ets,
  };
}

const resumo: Record<string, Record<string, unknown>> = {};
for (const hz of HORIZONTES) for (const E of ["E0", "E1", "E2"] as const) resumo[`H${hz}_${E}`] = ler(eventos, hz, E);

// ---------------------------------------------------------------- testes da §I
const testes: { nome: string; ok: boolean; detalhe: string }[] = [];
{
  const minIdx = eventos.length ? Math.min(...eventos.map((e) => e.t_in_idx)) : Infinity;
  testes.push({
    nome: "1. nenhuma visita nas primeiras L barras",
    ok: desprezadosWarmup.length === 0 && minIdx >= L,
    detalhe: `primeira visita em i=${minIdx} (L=${L}) · ${desprezadosWarmup.length} visitas descartadas no warmup`,
  });
}
{
  let viol = 0;
  for (const tipo of ["chao", "tecto"] as const) {
    const es = eventos.filter((e) => e.tipo === tipo).sort((a, b) => a.t_in_idx - b.t_in_idx);
    for (let k = 1; k < es.length; k++) {
      const a = es[k - 1], b = es[k];
      const zonaFim = tipo === "chao" ? CHAO : TECTO;
      let saiu = false;
      for (let i = a.t_in_idx + 1; i < b.t_in_idx; i++) {
        const u = uPorIdx.get(i);
        if (u === undefined) continue;
        if (tipo === "chao" ? u > CHAO : u < TECTO) saiu = true;
      }
      if (!saiu) viol++;
    }
  }
  testes.push({ nome: "2. duas barras seguidas na zona = uma visita so", ok: viol === 0, detalhe: `${viol} visitas sem saida da zona entre elas` });
}
{
  const maus = pontos.filter((p) => p.s !== 0 && H1[p.h1Idx].T > bars[p.i].t).length;
  const semH1 = pontos.filter((p) => p.h1Idx === 0 && H1.length && H1[0].T > bars[p.i].t).length;
  testes.push({ nome: "3. s usa H1 anterior, nunca a hora a formar", ok: maus === 0, detalhe: `${maus} barras com H1 futura · ${semH1} sem H1 fechada` });
}
{
  const ult = bars.length - 1;
  const viol = eventos.filter((e) => (e.t_in_idx + 72 > ult) !== (e.h["H72"].mov_bps === null)).length;
  testes.push({ nome: "4. a menos de 72 barras do fim = aberto em H3", ok: viol === 0, detalhe: `${viol} eventos inconsistentes com o fim da serie` });
}
{
  let viol = 0, verificados = 0;
  for (const hz of HORIZONTES) {
    const fechados = eventos.filter((e) => e.h[`H${hz}`].mov_bps !== null).length;
    const soma = (resumo[`H${hz}_E0`] as { _ets: string[] })._ets.length;
    verificados++;
    if (soma !== fechados) viol++;
  }
  testes.push({ nome: "5. alinhou+inverteu+sem_relacao = fechados no H", ok: viol === 0, detalhe: `${verificados} horizontes conferidos, ${viol} divergencias` });
}
{
  const difs = Object.entries(TABELA).filter(([n, k]) => minBinomial(Number(n)) !== k);
  testes.push({ nome: "6. tabela k/n do §H reproduzida pelo binomial", ok: difs.length === 0, detalhe: difs.length ? `divergencias: ${JSON.stringify(difs)}` : "12→10, 13→10, 16→12, 24→17, 36→24 todos conferidos" });
}

console.log();
console.log("== TESTES DO SCRIPT (§I, antes da leitura) ==");
for (const t of testes) console.log(`  [${t.ok ? "OK  " : "FALHA"}] ${t.nome} — ${t.detalhe}`);
if (testes.some((t) => !t.ok) && !process.argv.includes("--sem-teste")) {
  console.log("\n  Ha teste a falhar: a leitura nao se publica. Corrija-se o script primeiro.");
  process.exit(1);
}

// ---------------------------------------------------------------- saidas
const shaSerie = createHash("sha256").update(readFileSync(CACHE)).digest("hex").slice(0, 16);
let commit = "?";
try { commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); } catch { /* fora do repo */ }

const meta = {
  venue: "hyperliquid-testnet", coin: COIN, barras: vs.length,
  pedidas_solicitadas: Math.round((HORAS * 3_600_000) / 300_000),
  barras_recebidas: vs.length,
  truncada: vs.length < Math.round((HORAS * 3_600_000) / 300_000) * 0.9,
  nota_truncagem:
    "A fonte publica de 5 min deste venue acaba em ~5 030 barras (~17,5 dias): pedir 20 dias devolve-o todo. " +
    "Nao se chama a isto a janela pedida, e nao serve para 30/60 dias.",
  primeira_ts: vs[0].t, ultima_ts: vs[vs.length - 1].t,
  primeira_iso: new Date(vs[0].t).toISOString(), ultima_iso: new Date(vs[vs.length - 1].t).toISOString(),
  L, CHAO, TECTO, FLAT, horizontes_barras: HORIZONTES,
  sha_serie: shaSerie, commit, gerado_em: new Date().toISOString(),
};
writeFileSync(`${DIR}/meta.json`, JSON.stringify(meta, null, 1));
writeFileSync(`${DIR}/eventos.json`, JSON.stringify(
  eventos.map((e) => ({
    tipo: e.tipo, t_in: e.t_in, t_in_iso: new Date(e.t_in).toISOString(), mid_in: e.mid_in, u_in: Number(e.u_in.toFixed(4)),
    s_in: e.s_in,
    H12: { ...e.h.H12, etiqueta: etiqueta(e.tipo, e.h.H12.mov_bps) },
    H36: { ...e.h.H36, etiqueta: etiqueta(e.tipo, e.h.H36.mov_bps) },
    H72: { ...e.h.H72, etiqueta: etiqueta(e.tipo, e.h.H72.mov_bps) },
  })), null, 1));
writeFileSync(`${DIR}/resumo.json`, JSON.stringify(resumo, null, 1));

const linhas: string[] = [];
linhas.push("# Ensaio dos extremos — short no tecto, long no chão (horizonte fixo)");
linhas.push("");
linhas.push(`Fonte: ${meta.venue} ${COIN} · ${meta.barras} barras de 5 min (pedidas ${meta.pedidas_solicitadas}${meta.truncada ? ", TRUNCADA" : ", a fonte tem menos: ve o meta.json"})`);
linhas.push(`Janela: ${meta.primeira_iso} → ${meta.ultima_iso}`);
linhas.push(`L=${L} · CHAO=${CHAO} · TECTO=${TECTO} · FLAT=${FLAT} bps · horizontes 12/36/72 barras · serie \`${shaSerie}\` · commit \`${commit}\``);
linhas.push("");
linhas.push("Visita = uma linha (t_in = primeira barra da visita). Zero produto, zero sessão, zero Pine.");
linhas.push("");
for (const hz of HORIZONTES) {
  linhas.push(`## H${hz} (${(hz * 5) / 60} h)`);
  linhas.push("");
  linhas.push("| leitura | fechados | chao/tecto | elegíveis | alinhou | inverteu | razão | med chao (bps) | med tecto (bps) | abertos | mínimo k/n | veredicto |");
  linhas.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const E of ["E0", "E1", "E2"] as const) {
    const r = resumo[`H${hz}_${E}`] as Record<string, number | string | null>;
    linhas.push(
      `| **${E}**${E === "E0" ? " (todos)" : E === "E1" ? " (s a favor)" : " (s contra)"} | ${r.n_eventos_fechados} | ${r.n_chao}/${r.n_tecto} | ${r.elegiveis} | ${r.alinhou} | ${r.inverteu} | ${r.razao === null ? "—" : (r.razao as number).toFixed(3)} | ${r.mediana_mov_chao ?? "—"} | ${r.mediana_mov_tecto ?? "—"} | ${r.n_abertos} | ${r.minimo_binomial ?? "—"} | **${r.veredicto}** |`,
    );
  }
  const e0 = resumo[`H${hz}_E0`] as Record<string, number | null>;
  const e1 = resumo[`H${hz}_E1`] as Record<string, number | null>;
  const melhor = e1.razao !== null && e0.razao !== null && (e1.razao as number) > (e0.razao as number) && (e1.elegiveis as number) >= 12;
  linhas.push("");
  linhas.push(`E1 vs E0: razão ${e1.razao === null ? "—" : (e1.razao as number).toFixed(3)} vs ${e0.razao === null ? "—" : (e0.razao as number).toFixed(3)} · n_E1=${e1.elegiveis} → ${melhor ? "**E1 melhor que E0**" : "não se declara melhor"}`);
  linhas.push("");
}
linhas.push("Não se somam horizontes. `s=0` entra em E0 e em nenhum dos outros. Sem estadia flip→flip, sem piso de 6 h.");
writeFileSync(`${DIR}/RESUMO.md`, `${linhas.join("\n")}\n`);

console.log();
console.log("== RESUMO ==");
for (const hz of HORIZONTES) {
  for (const E of ["E0", "E1", "E2"] as const) {
    const r = resumo[`H${hz}_${E}`] as Record<string, number | string | null>;
    console.log(
      `  H${hz} ${E}: fechados ${r.n_eventos_fechados} (chao ${r.n_chao}/tecto ${r.n_tecto}) · elegiveis ${r.elegiveis}` +
        ` · alinhou ${r.alinhou} / inverteu ${r.inverteu} · razao ${r.razao === null ? "-" : (r.razao as number).toFixed(3)}` +
        ` · minimo ${r.minimo_binomial ?? "-"} · ${r.veredicto} · abertos ${r.n_abertos}`,
    );
  }
}
console.log();
console.log(`  artefactos: ${DIR}/meta.json · eventos.json · resumo.json · RESUMO.md`);
