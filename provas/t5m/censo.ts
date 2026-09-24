#!/usr/bin/env bun
/**
 * T-5m — prova de volume no cliente **e** censo de estadias (READ-ONLY).
 *
 * Faz duas coisas, antes de qualquer commit de arranque:
 *
 * 1. **Prova de volume**: imprime a vela de 5 min crua do cliente HL — se o campo `v` não
 *    existir/não for positivo, a metade V do ensaio fica declarada "fonte ausente".
 * 2. **Censo de estadias do §2** sobre o histórico público: quantas estadias P existem por
 *    24 h neste livro, quantas são elegíveis (|mov| ≥ 20 bps, ≥ 2 barras de 5 min) e como
 *    se distribui o volume. É a mesma aritmética que reprovou o desenho inicial do N1 —
 *    feita antes de gastar 12–24 h de sessão.
 *
 * Regras do dono, aplicadas aqui:
 *  - `hl2` da barra de 5 min **fechada** (nunca a que está a formar);
 *  - `MA_H1` = EMA 24 no TF 60 min, só barras H1 **já fechadas** (sem lookahead/repeinte);
 *  - `sig_p = sign(hl2_5m − MA_H1)` ∈ {+1,−1,0}; `sig_v = sign(vol − EMA24_vol_5m)`;
 *  - estadia = do 5 min em que `sig_p` muda até ao que muda para o contrário; `sig_p = 0`
 *    fecha a estadia anterior (hold);
 *  - rótulo = `hl2` no início → `hl2` no fim; elegível se `|mov| ≥ 20 bps` e duração ≥ 2 barras.
 *
 * Uso: bun run provas/t5m/censo.ts [coin] [horasDeHistorico]
 */
import { InfoClient } from "@nktkas/hyperliquid";
import { transportFor } from "../../src/ledger/marks_source";

const coin = process.argv[2] ?? "BTC";
const horas = Number(process.argv[3] ?? 48);
const T5 = 5 * 60_000;
const H1 = 60 * 60_000;
const CORTE_BPS = 20;

const info = new InfoClient({ transport: transportFor() });
const agora = Date.now();

const c5 = await info.candleSnapshot({ coin, interval: "5m", startTime: agora - horas * H1, endTime: agora });
const c1h = await info.candleSnapshot({ coin, interval: "1h", startTime: agora - 8 * 24 * H1, endTime: agora });

console.log("== 1. PROVA DE VOLUME (vela de 5 min crua do cliente) ==");
const ultima = c5[c5.length - 1] as unknown as Record<string, unknown>;
console.log("  campos:", Object.keys(ultima).join(", "));
console.log(`  ultima vela 5m: t=${ultima.t} T=${ultima.T} o=${ultima.o} h=${ultima.h} l=${ultima.l} c=${ultima.c} v=${ultima.v} n=${ultima.n}`);
const vNum = Number(ultima.v);
console.log(
  `  volume presente e positivo: ${Number.isFinite(vNum) && vNum > 0 ? "SIM" : "NAO"}` +
    ` (v=${ultima.v} · n=${ultima.n})`,
);
if (!Number.isFinite(vNum) || vNum <= 0) {
  console.log('  => sem volume no cliente: a sessao correria SO P, com vol/sig_v = null e leitura V/P+V "sem fonte".');
}
console.log(`  barras: 5m ${c5.length} · 1h ${c1h.length}`);

// ---------- série fechada, sem lookahead ----------
type Bar = { t: number; T: number; hl2: number; v: number; c: number };
const bars5: Bar[] = c5.map((x) => {
  const h = Number(x.h), l = Number(x.l), c = Number(x.c);
  return { t: x.t, T: x.T, hl2: (h + l) / 2, v: Number(x.v), c };
});
const bars1h: Bar[] = c1h.map((x) => {
  const h = Number(x.h), l = Number(x.l);
  return { t: x.t, T: x.T, hl2: (h + l) / 2, v: Number(x.v), c: Number(x.c) };
});

/** EMA 24 sobre uma série (período 24, o mesmo número do §2). */
function ema24(xs: number[]): number[] {
  const k = 2 / (24 + 1);
  const out: number[] = [];
  let e: number | null = null;
  for (const x of xs) {
    e = e === null ? x : x * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

// EMA24 do H1 sobre as barras H1 fechadas ANTES de cada barra de 5 min
const emaH1 = ema24(bars1h.map((b) => b.hl2));
const vol5 = ema24(bars5.map((b) => b.v));

const sig: { t: number; hl2: number; sp: number; sv: number; maH1: number; vol: number; maVol: number }[] = [];
let i1 = 0;
for (let i = 0; i < bars5.length; i++) {
  const b = bars5[i];
  // ultima barra H1 com fecho (T) <= t: "ja fechada" no instante da decisao
  while (i1 + 1 < bars1h.length && bars1h[i1 + 1].T <= b.t) i1++;
  if (bars1h[i1].T > b.t) continue; // ainda nao havia H1 fechada
  const maH1 = emaH1[i1];
  const maVol = vol5[i];
  const dp = b.hl2 - maH1;
  const dv = b.v - maVol;
  const eps = 1e-9;
  sig.push({
    t: b.t, hl2: b.hl2,
    sp: dp > eps ? 1 : dp < -eps ? -1 : 0,
    sv: dv > eps ? 1 : dv < -eps ? -1 : 0,
    maH1, vol: b.v, maVol,
  });
}

// ---------- estadias ----------
type Est = { de: number; ate: number; sign: number; barras: number; mov: number; volAlto: number; svEntrada: number };
const est: Est[] = [];
let cur: { de: number; sign: number; n: number; vAlto: number; svIn: number } | null = null;
for (const s of sig) {
  if (s.sp === 0) {
    if (cur) { est.push({ de: cur.de, ate: 0, sign: cur.sign, barras: cur.n, mov: 0, volAlto: cur.vAlto, svEntrada: cur.svIn }); cur = null; }
    continue;
  }
  if (cur && s.sp === cur.sign) { cur.n++; cur.vAlto += s.sv > 0 ? 1 : 0; continue; }
  if (cur) est.push({ de: cur.de, ate: 0, sign: cur.sign, barras: cur.n, mov: 0, volAlto: cur.vAlto, svEntrada: cur.svIn });
  // `svEntrada` = o `sig_v` da barra de ENTRADA da estadia: e nessa barra que a matriz P+V decide.
  cur = { de: s.t, sign: s.sp, n: 1, vAlto: s.sv > 0 ? 1 : 0, svIn: s.sv };
}
// fecho dos rótulos: início da estadia -> hl2 no primeiro 5 min do sentido seguinte
for (let i = 0; i < est.length; i++) {
  const fim = est[i + 1] ? est[i + 1].de : null;
  const fimBar = fim === null ? sig[sig.length - 1] : sig.find((s) => s.t === fim);
  const iniBar = sig.find((s) => s.t === est[i].de)!;
  const fimPx = fimBar ? (fim === null ? fimBar.hl2 : fimBar.hl2) : iniBar.hl2;
  est[i].ate = fim ?? sig[sig.length - 1].t;
  est[i].mov = ((fimPx - iniBar.hl2) / iniBar.hl2) * 10_000;
}
const estFechadas = est.filter((e) => e.barras >= 1 && e.ate > e.de);
const eleg = estFechadas.filter((e) => Math.abs(e.mov) >= CORTE_BPS && e.barras >= 2);

console.log();
console.log(`== 2. CENSO DAS ESTADIAS (${coin}, ultimas ${horas} h de barras de 5 min) ==`);
console.log(`  barras de 5 min com H1 fechada disponivel: ${sig.length}`);
console.log(`  sinais: +1 ${sig.filter((s) => s.sp === 1).length} · -1 ${sig.filter((s) => s.sp === -1).length} · 0 ${sig.filter((s) => s.sp === 0).length}`);
console.log(`  ESTADIAS fechadas: ${estFechadas.length} em ${horas} h  (${(estFechadas.length / (horas / 24)).toFixed(1)} por 24 h)`);
console.log(`  elegiveis (|mov| >= ${CORTE_BPS} bps e >= 2 barras): ${eleg.length}  => ${((eleg.length / (horas / 24))).toFixed(1)} por 24 h`);
const movs = eleg.map((e) => Math.abs(e.mov)).sort((x, y) => x - y);
if (movs.length) {
  console.log(`  |mov| das elegiveis: min ${movs[0].toFixed(1)} · mediana ${movs[Math.floor(movs.length / 2)].toFixed(1)} · max ${movs[movs.length - 1].toFixed(1)} bps`);
}
console.log(`  duracao das elegiveis (barras de 5 min): ${eleg.map((e) => e.barras).join(", ")}`);
console.log(`  sentidos das elegiveis: +1 ${eleg.filter((e) => e.sign === 1).length} · -1 ${eleg.filter((e) => e.sign === -1).length}`);
console.log();
console.log("  tabela das estadias (corte 20 bps):");
console.log("    de                 barras  sign  |mov| bps  volAlto  etiqueta");
for (const e of estFechadas.sort((a, b) => a.de - b.de)) {
  const el = Math.abs(e.mov) >= CORTE_BPS && e.barras >= 2;
  const alinhou = el && ((e.sign === 1 && e.mov > 0) || (e.sign === -1 && e.mov < 0));
  const et = el ? (alinhou ? "alinhou" : "inverteu") : "sem_relacao";
  const d = new Date(e.de).toISOString().slice(5, 16).replace("T", " ");
  console.log(`    ${d.padEnd(18)} ${String(e.barras).padStart(6)} ${String(e.sign).padStart(5)} ${Math.abs(e.mov).toFixed(1).padStart(10)} ${String(e.volAlto).padStart(8)}  ${et}`);
}
if (movs.length) {
  const al = eleg.filter((e) => (e.sign === 1 && e.mov > 0) || (e.sign === -1 && e.mov < 0)).length;
  console.log(`\n  P (so preco): ${al}/${eleg.length} alinhou  ->  alinhou/(alinhou+inverteu) = ${al}/${al + (eleg.length - al)}`);
  // P+V pela matriz do dono: a decisao e na ENTRADA da estadia (sig_v da primeira barra).
  const entrou = eleg.filter((e) => e.svEntrada === 1);
  const cortadas = eleg.filter((e) => e.svEntrada !== 1);
  const alV = entrou.filter((e) => (e.sign === 1 && e.mov > 0) || (e.sign === -1 && e.mov < 0)).length;
  console.log(`  P+V (entrada com sig_v = +1): ${alV}/${entrou.length} alinhou  ·  cortadas pelo V: ${cortadas.length}/${eleg.length}`);
  const med = (xs: number[]) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN);
  const alto = eleg.filter((e) => e.svEntrada === 1).map((e) => Math.abs(e.mov));
  const baixo = eleg.filter((e) => e.svEntrada !== 1).map((e) => Math.abs(e.mov));
  console.log(`  V: |mov| mediano com sig_v=+1: ${Number.isFinite(med(alto)) ? med(alto).toFixed(1) : "-"} bps (n=${alto.length})` +
    `  ·  com sig_v!=+1: ${Number.isFinite(med(baixo)) ? med(baixo).toFixed(1) : "-"} bps (n=${baixo.length})`);
  const sentido = new Set(eleg.map((e) => Math.sign(e.mov)));
  console.log(`  guarda "os dois sentidos de preco": ${sentido.size === 2 ? "satisfeita" : "NAO (amostra enviesada)"}`);
  const MIN = 12, TAB: Record<number, number> = { 12: 10, 16: 12, 24: 17 };
  const nEl = eleg.length;
  console.log(`  binomial (p<0,05 unilateral): n=${nEl} -> minimo ${TAB[Math.min(...Object.keys(TAB).map(Number).filter((k) => k <= nEl))] ?? "-"} de ${nEl}`);
}
console.log();
console.log("  (read-only: nada foi escrito no ledger; so o historico publico foi lido)");
