#!/usr/bin/env bun
/**
 * T-5m — prova de volume no cliente **e** censo de estadias (READ-ONLY).
 *
 * Faz três coisas, e nenhuma delas gasta sessão:
 *
 * 1. **Prova de volume**: imprime a vela de 5 min crua do cliente HL — se o campo `v` não
 *    existir/não for positivo, a metade V do ensaio fica declarada "fonte ausente".
 * 2. **Censo de estadias do §2** sobre o histórico público: quantas estadias P existem por
 *    24 h neste livro, quantas são elegíveis (|mov| ≥ 20 bps, ≥ 2 barras de 5 min) e como
 *    se distribui o volume.
 * 3. **Piso de 6 h — DIAGNÓSTICO, declarado antes de correr** (decisão do dono, 24 set): separa
 *    as elegíveis em **longas** (≥ 72 barras = 6 h — a estadia-regime) e **curtas** (2–71
 *    barras — o cruzamento curto). A pergunta: "o FAIL do censo de 14 dias é o cruzamento
 *    curto ou a regra inteira?". Não promove nada: se as longas alinharem e as curtas
 *    inverterem, isso é um corte de duração — **outro** ensaio, declarado, ainda em histórico.
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
/** Piso diagnosticado: 6 h em barras de 5 min (a estadia-regime, não o cruzamento curto). */
const PISO_6H = 72;

const info = new InfoClient({ transport: transportFor() });
const agora = Date.now();

type Vela = { t: number; T: number; o: string; h: string; l: string; c: string; v: string; n: number };

/**
 * Candles paginados: o endpoint devolve janelas limitadas, logo anda-se para a frente a partir
 * do último `t` recebido. Uma barra de 5 min sozinha não denuncia o corte — a lista é que sim.
 */
async function velas(interval: "5m" | "1h", de: number, ate: number, passoMs: number): Promise<Vela[]> {
  const out: Vela[] = [];
  let from = de;
  for (let i = 0; i < 300; i++) {
    const chunk = (await info.candleSnapshot({ coin, interval, startTime: from, endTime: ate })) as unknown as Vela[];
    if (!chunk.length) break;
    out.push(...chunk);
    const ultimo = chunk[chunk.length - 1].t;
    if (ultimo + passoMs > ate) break;
    from = ultimo + passoMs;
    await Bun.sleep(120); // cortesia com o endpoint público
  }
  return out;
}

const c5 = await velas("5m", agora - horas * H1, agora, T5);
// H1 com folga de 8 dias antes da janela: a EMA 24 precisa de barras fechadas a montante.
// Aquecimento LONGO da EMA24 (ver provas/t5m/diagnostico-s.ts): 60 dias antes da janela.
const c1h = await velas("1h", agora - (horas + 60 * 24) * H1, agora, H1);

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
if (c5.length < (horas * 60) / 5 * 0.9) {
  console.log(`  AVISO: esperava ~${((horas * 60) / 5).toFixed(0)} barras de 5m e vieram ${c5.length} — historico curto nesta fonte.`);
}

// ---------- série fechada, sem lookahead ----------
type Bar = { t: number; T: number; hl2: number; v: number };
const bars5: Bar[] = c5.map((x) => ({ t: x.t, T: x.T, hl2: (Number(x.h) + Number(x.l)) / 2, v: Number(x.v) }));
const bars1h: Bar[] = c1h.map((x) => ({ t: x.t, T: x.T, hl2: (Number(x.h) + Number(x.l)) / 2, v: Number(x.v) }));

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

const emaH1 = ema24(bars1h.map((b) => b.hl2));
const vol5 = ema24(bars5.map((b) => b.v));

const sig: { t: number; hl2: number; sp: number; sv: number }[] = [];
let i1 = 0;
for (let i = 0; i < bars5.length; i++) {
  const b = bars5[i];
  while (i1 + 1 < bars1h.length && bars1h[i1 + 1].T <= b.t) i1++;
  if (!bars1h.length || bars1h[i1].T > b.t) continue; // ainda nao havia H1 fechada
  const dp = b.hl2 - emaH1[i1];
  const dv = b.v - vol5[i];
  const eps = 1e-9;
  sig.push({ t: b.t, hl2: b.hl2, sp: dp > eps ? 1 : dp < -eps ? -1 : 0, sv: dv > eps ? 1 : dv < -eps ? -1 : 0 });
}

// ---------- estadias ----------
type Est = { de: number; ate: number; sign: number; barras: number; mov: number; svEntrada: number };
const est: Est[] = [];
let cur: { de: number; sign: number; n: number; svIn: number } | null = null;
for (const s of sig) {
  if (s.sp === 0) {
    if (cur) { est.push({ de: cur.de, ate: 0, sign: cur.sign, barras: cur.n, mov: 0, svEntrada: cur.svIn }); cur = null; }
    continue;
  }
  if (cur && s.sp === cur.sign) { cur.n++; continue; }
  if (cur) est.push({ de: cur.de, ate: 0, sign: cur.sign, barras: cur.n, mov: 0, svEntrada: cur.svIn });
  // `svEntrada` = o `sig_v` da barra de ENTRADA da estadia: e nessa barra que a matriz P+V decide.
  cur = { de: s.t, sign: s.sp, n: 1, svIn: s.sv };
}
for (let i = 0; i < est.length; i++) {
  const proxima = est[i + 1];
  const iniBar = sig.find((s) => s.t === est[i].de)!;
  const fimBar = proxima ? sig.find((s) => s.t === proxima.de) : sig[sig.length - 1];
  est[i].ate = proxima ? proxima.de : sig[sig.length - 1].t;
  est[i].mov = (((fimBar ?? iniBar).hl2 - iniBar.hl2) / iniBar.hl2) * 10_000;
}

const alinhada = (e: Est) => (e.sign === 1 && e.mov > 0) || (e.sign === -1 && e.mov < 0);
const estFechadas = est.filter((e) => e.ate > e.de);
const eleg = estFechadas.filter((e) => Math.abs(e.mov) >= CORTE_BPS && e.barras >= 2);
const dias = horas / 24;

console.log();
console.log(`== 2. CENSO DAS ESTADIAS (${coin}, ${horas} h = ${dias} dias de barras de 5 min) ==`);
console.log(`  barras de 5 min com H1 fechada disponivel: ${sig.length}`);
console.log(`  sinais: +1 ${sig.filter((s) => s.sp === 1).length} · -1 ${sig.filter((s) => s.sp === -1).length} · 0 ${sig.filter((s) => s.sp === 0).length}`);
console.log(`  ESTADIAS fechadas: ${estFechadas.length} (${(estFechadas.length / dias).toFixed(1)} por 24 h)`);
console.log(`  elegiveis (|mov| >= ${CORTE_BPS} bps e >= 2 barras): ${eleg.length} (${(eleg.length / dias).toFixed(1)} por 24 h)`);
const movs = eleg.map((e) => Math.abs(e.mov)).sort((x, y) => x - y);
if (movs.length) {
  console.log(`  |mov| das elegiveis: min ${movs[0].toFixed(1)} · mediana ${movs[Math.floor(movs.length / 2)].toFixed(1)} · max ${movs[movs.length - 1].toFixed(1)} bps`);
}
console.log(`  sentidos das elegiveis: +1 ${eleg.filter((e) => e.sign === 1).length} · -1 ${eleg.filter((e) => e.sign === -1).length}`);
console.log();
console.log("  tabela das estadias elegiveis (corte 20 bps):");
console.log("    de                 barras   horas  sign  |mov| bps  etiqueta");
for (const e of eleg.slice().sort((a, b) => a.de - b.de)) {
  const d = new Date(e.de).toISOString().slice(5, 16).replace("T", " ");
  console.log(
    `    ${d.padEnd(18)} ${String(e.barras).padStart(6)} ${(e.barras / 12).toFixed(1).padStart(6)} ${String(e.sign).padStart(5)} ` +
      `${Math.abs(e.mov).toFixed(1).padStart(10)}  ${alinhada(e) ? "alinhou" : "inverteu"}`,
  );
}

// ---------- 3. P com o piso de 6 h (diagnostico declarado) ----------
const ratio = (xs: Est[]) => {
  const al = xs.filter(alinhada).length;
  return { n: xs.length, al, inv: xs.length - al, pct: xs.length ? (100 * al) / xs.length : NaN };
};
const todas = ratio(eleg);
const longas = ratio(eleg.filter((e) => e.barras >= PISO_6H));
const curtas = ratio(eleg.filter((e) => e.barras >= 2 && e.barras < PISO_6H));
const minima = (k: number) => (k <= 0 ? 0 : k <= 12 ? 10 : k <= 16 ? 12 : k <= 24 ? 17 : Math.ceil(k * 0.67));

console.log();
console.log(`== 3. P — ELEGIVEIS, CORTE DIAGNOSTICO PELO PISO DE 6 h (${PISO_6H} barras) ==`);
console.log(`  todas as elegiveis  : n=${todas.n}  alinhou ${todas.al} · inverteu ${todas.inv}  ->  ${todas.n ? todas.pct.toFixed(1) : "-"} %`);
console.log(`  LONGAS (>= 6 h)     : n=${longas.n}  alinhou ${longas.al} · inverteu ${longas.inv}  ->  ${longas.n ? longas.pct.toFixed(1) : "-"} %`);
console.log(`  CURTAS (2-71 barras): n=${curtas.n}  alinhou ${curtas.al} · inverteu ${curtas.inv}  ->  ${curtas.n ? curtas.pct.toFixed(1) : "-"} %`);
console.log(`  binomial (p<0,05 unilateral): minimo ${minima(longas.n)} de ${longas.n} para as longas`);
if (longas.n >= 12) {
  console.log(
    longas.al >= minima(longas.n)
      ? "  => as LONGAS alinham acima do minimo: o FAIL estaria no cruzamento curto (seria OUTRO ensaio, declarado, em historico)."
      : "  => as LONGAS nao alinham: o FAIL e a regra inteira, nao o cruzamento curto.",
  );
} else {
  console.log(`  => longas com n=${longas.n} < 12: sem potencia para decidir; le-se como diagnostico.`);
}

// ---------- 4. P+V e V ----------
if (eleg.length) {
  const entrou = eleg.filter((e) => e.svEntrada === 1);
  const alV = entrou.filter(alinhada).length;
  console.log();
  console.log("== 4. P+V e V ==");
  console.log(`  so preco (todas): alinhou ${todas.al}/${todas.n}`);
  console.log(`  P+V (entrada com sig_v = +1): ${alV}/${entrou.length} alinhou  ·  cortadas pelo V: ${eleg.length - entrou.length}/${eleg.length}`);
  const med = (xs: number[]) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN);
  const alto = entrou.map((e) => Math.abs(e.mov));
  const baixo = eleg.filter((e) => e.svEntrada !== 1).map((e) => Math.abs(e.mov));
  console.log(`  V: |mov| mediano com sig_v=+1: ${Number.isFinite(med(alto)) ? med(alto).toFixed(1) : "-"} bps (n=${alto.length})` +
    `  ·  com sig_v!=+1: ${Number.isFinite(med(baixo)) ? med(baixo).toFixed(1) : "-"} bps (n=${baixo.length})`);
  const sentido = new Set(eleg.map((e) => Math.sign(e.mov)));
  console.log(`  guarda "os dois sentidos de preco": ${sentido.size === 2 ? "satisfeita" : "NAO (amostra enviesada)"}`);
}
console.log();
console.log("  (read-only: nada foi escrito no ledger; so o historico publico foi lido)");
