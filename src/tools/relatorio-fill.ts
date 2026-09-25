/**
 * F7 — relatorio da corrida seca do sigma. Le o ledger e confronta o fill com o mid, contra o
 * ensaio (markout hl2, 6 bps ida-e-volta). **Nao decide aresta e nao projecta PnL**: mede o
 * mecanismo — como a ordem encheu, a que distancia do mid, e com que taxa assumida.
 *
 *   bun run src/tools/relatorio-fill.ts [--desde 20260925T000000Z] [--sleeve BTC] [--horas 24]
 *
 * `--desde` corta pelo `cycle_id` (o instante viaja no id): o ledger tem sessoes antigas e e
 * preciso dizer de quando sao os numeros. Sem ele, as ultimas `--horas` horas.
 */
import { Ledger, type FillLine } from "../ledger/jsonl";

interface Args {
  desde: string | null;
  sleeve: string;
  horas: number;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? (argv[i + 1] ?? null) : null;
  };
  return {
    desde: get("desde"),
    sleeve: get("sleeve") ?? "BTC",
    horas: Number(get("horas") ?? "24"),
  };
}

/** `20260925T000000Z` da `horas` atras, no formato que o `cycle_id` usa. */
function desdePorHoras(horas: number): string {
  const d = new Date(Date.now() - horas * 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

const media = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
function mediana(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
const bps = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${x.toFixed(2)}` : "n/a");

const args = parseArgs(Bun.argv.slice(2));
const desde = args.desde ?? desdePorHoras(args.horas);
const dir = process.env.LEDGER_DIR ?? "./data/ledger";
const ledger = new Ledger(dir);

let decisoes = 0;
let caixa = 0;
let cb = 0;
let cbArmado = 0;
let vetos = 0;
let relogioParado = 0;
let sinais: Record<string, number> = {};
const fills: FillLine[] = [];

for (const day of ledger.days()) {
  for (const sleeve of ledger.sleevesOf(day)) {
    if (sleeve.toUpperCase() !== args.sleeve.toUpperCase()) continue;
    for (const line of ledger.read(sleeve, day)) {
      if (line.cycle_id.split("-")[0]! < desde) continue;
      if (line.kind === "fill") {
        fills.push(line);
        continue;
      }
      if (line.kind !== "decision") continue;
      decisoes++;
      const v = line as {
        raw?: string; signal?: string; wick_veto?: boolean; cb_active?: boolean; cb_until?: number;
        verdict?: { clock_hold?: boolean };
      };
      sinais[v.signal ?? "?"] = (sinais[v.signal ?? "?"] ?? 0) + 1;
      if (v.raw === "caixa") caixa++;
      if (v.wick_veto) vetos++;
      if (v.cb_active) cb++;
      if (v.cb_active && v.cb_until) cbArmado += 1;
      // O `clock_hold` aparece no veredicto gravado, nao no topo da linha.
      if (v.verdict?.clock_hold) relogioParado++;
    }
  }
}

const bpsTodos = fills.map((f) => f.fill_bps);
const fee = fills.map((f) => f.fee_bps);
const liquido = fills.map((f) => f.fill_bps - f.fee_bps);
const maker = fills.filter((f) => f.fill_role === "maker").length;
const taker = fills.filter((f) => f.fill_role === "taker").length;
const mixed = fills.filter((f) => f.fill_role === "mixed").length;
const aloCheio = fills.filter((f) => f.unfilled <= 0).length;
const comResto = fills.length - aloCheio;

const pct = (n: number, d: number) => (d > 0 ? `${((100 * n) / d).toFixed(1)}%` : "n/a");

console.log(`relatorio do fill do sigma  (ledger ${dir}, sleeve ${args.sleeve}, desde ${desde})`);
console.log("");
console.log(`  decisoes                 ${decisoes}`);
console.log(`  episodios com fill       ${fills.length}`);
console.log(`  fill vs mid (bps)        media ${bps(media(bpsTodos))}   mediana ${bps(mediana(bpsTodos))}`);
console.log(`  taxa assumida (bps)      media ${bps(media(fee))}   ida-e-volta ~${bps(2 * media(fee))}  (ensaio: 6,00)`);
console.log(`  liquido da taxa (bps)    media ${bps(media(liquido))}   mediana ${bps(mediana(liquido))}`);
console.log(`  papel                    maker ${pct(maker, fills.length)} (${maker})  taker ${pct(taker, fills.length)} (${taker})  mixed ${pct(mixed, fills.length)} (${mixed})`);
console.log(`  ALO que encheu nos 8 s   ${pct(aloCheio, fills.length)} (${aloCheio})   com resto para a Ioc ${pct(comResto, fills.length)} (${comResto})`);
console.log(`  caixa (s=0 ou CB)        decisoes ${caixa}   com CB activo ${cb}   (CB armado ${cbArmado})`);
console.log(`  veto de pavio            ${vetos}`);
console.log(`  tick no portao (hold)    ${relogioParado}`);
console.log(`  sinais                   ${Object.entries(sinais).map(([k, v]) => `${k}=${v}`).join(" ")}`);
console.log("");
console.log("  (corrida seca, livro de testnet, sem signer. Sem projeccao de PnL: e o mecanismo.)");
