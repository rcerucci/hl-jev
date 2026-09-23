#!/usr/bin/env bun
/**
 * V4b-0, parte 1: replay **offline** de `jev` (gravado) x `dumb` (recomputado com o
 * código de produto) sobre os **mesmos** estados gravados.
 *
 * Sem rede, sem chave, sem Laya. A coluna Laya é a parte 2 (precisa dos pesos).
 *
 * A `dumb` **não** é recopiada aqui: importa-se `dumbAct`/`dumbHostile` de
 * `src/policy/dumb.ts`, para o replay correr exactamente a heurística que o motor
 * corre em `POLICY=dumb`. Recopiar a heurística mediria a cópia, não o produto.
 *
 * O `act` gravado no ledger é o verdict **cru** do modelo (o gate é aplicado
 * depois, em `risk/intent.ts`); por isso o replay aplica o gate aqui, pela mesma
 * ordem do produto: `hostile` primeiro, `low_conf` depois.
 *
 * Uso: bun run provas/v4b-0/replay-jev-dumb.ts [--json out.json]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

import { dumbAct, dumbHostile } from "../../src/policy/dumb";
import { DUMB } from "../../src/policy/dumb";

const CONF_ACT = Number(process.env.JEV_CONF_ACT ?? "0.80");
const HOSTILE_TH = Number(process.env.NOUL_HOSTILE_TH ?? "0.65");
const LEDGER = process.env.LEDGER_DIR ?? "data/ledger";

type Linha = Record<string, any>;

function lerLedger(): Linha[] {
  const out: Linha[] = [];
  for (const f of readdirSync(LEDGER).filter((f) => f.endsWith(".jsonl")).sort()) {
    for (const l of readFileSync(`${LEDGER}/${f}`, "utf8").split("\n")) {
      if (l.trim()) out.push(JSON.parse(l));
    }
  }
  return out;
}

const cont = (xs: (string | null)[]) =>
  xs.reduce<Record<string, number>>((a, x) => ((a[String(x)] = (a[String(x)] ?? 0) + 1), a), {});

const quantis = (xs: number[], qs = [0, 25, 50, 75, 90, 100]) => {
  const s = [...xs].sort((a, b) => a - b);
  const o: Record<string, number> = {};
  for (const q of qs) o[`p${q}`] = s[Math.min(s.length - 1, Math.max(0, Math.round((q / 100) * (s.length - 1))))]!;
  return o;
};

/** Gate do produto, na ordem do produto (`src/risk/intent.ts`). */
function gate(act: string, conf: number, tooHostile: number): "hostile" | "low_conf" | null {
  if (tooHostile >= HOSTILE_TH) return "hostile";
  if (!(conf >= CONF_ACT)) return "low_conf";
  return null;
}

const rows = lerLedger();
const decs = rows.filter((r) => r.kind === "decision" && r.verdict);
const outs = rows.filter((r) => r.kind === "outcome");
const validos = decs.filter((r) => r.verdict.raw_ok !== false);

// ---------------------------------------------------------------- vocabulário
const tokens: Record<number, Record<string, number>> = {};
const estadosDistintos = new Set<string>();
for (const r of validos) {
  estadosDistintos.add(r.state);
  r.state.split(/\s+/).forEach((t: string, i: number) => {
    tokens[i] = tokens[i] ?? {};
    tokens[i]![t] = (tokens[i]![t] ?? 0) + 1;
  });
}

// --------------------------------------------------- jev (gravado) x dumb (replay)
const jev = { total: 0, actos: [] as string[], confs: [] as number[], sides: 0, nLados: 0, gated: 0 };
const dumb = { total: 0, actos: [] as string[], confs: [] as number[], sides: 0, nLados: 0, gated: 0 };
const ladosDumb: { state: string; act: string; jevAct: string; cycle: string; conf: number }[] = [];
const noulHist: Record<string, number> = {};
const noulVsChoice: Record<string, Record<string, number>> = {
  "noul >= th (hostil)": {},
  "noul < th": {},
};

for (const r of validos) {
  const v = r.verdict;
  const conf = Number(v.act_conf ?? 0);
  const noul = Number(v.too_hostile ?? 0);
  const act = String(v.act ?? "hold");

  jev.total++;
  jev.actos.push(act);
  jev.confs.push(conf);
  if (act === "buy" || act === "sell") {
    jev.sides++;
    if (conf >= CONF_ACT) jev.nLados++;
  }
  if (gate(act, conf, noul)) jev.gated++;

  const da = dumbAct(r.state);
  const dconf = da === "hold" ? DUMB.CONF_ON_HOLD : DUMB.CONF_ON_SIDE;
  const dnoul = dumbHostile(r.state) ? DUMB.HOSTILE_TRUE : DUMB.HOSTILE_FALSE;
  dumb.total++;
  dumb.actos.push(da);
  dumb.confs.push(dconf);
  if (da === "buy" || da === "sell") {
    dumb.sides++;
    if (dconf >= CONF_ACT) dumb.nLados++;
    ladosDumb.push({ state: r.state, act: da, jevAct: act, cycle: r.cycle_id, conf: dconf });
  }
  if (gate(da, dconf, dnoul)) dumb.gated++;

  const faixa = `${(Math.floor(noul * 10) / 10).toFixed(1)}`;
  noulHist[faixa] = (noulHist[faixa] ?? 0) + 1;
  const chave = noul >= HOSTILE_TH ? "noul >= th (hostil)" : "noul < th";
  noulVsChoice[chave]![act] = (noulVsChoice[chave]![act] ?? 0) + 1;
}

// --------------------------------------------------------------- dir_after por hora
const porHora: Record<string, { total: number; dirs: Record<string, number>; mov: number[] }> = {};
for (const o of outs) {
  const hora = String(o.cycle_id).slice(0, 11) + "Z";
  const mov = ((o.mark_plus_15m - o.mark_then) / o.mark_then) * 1e4;
  porHora[hora] = porHora[hora] ?? { total: 0, dirs: {}, mov: [] };
  porHora[hora]!.total++;
  porHora[hora]!.dirs[String(o.dir_after)] = (porHora[hora]!.dirs[String(o.dir_after)] ?? 0) + 1;
  porHora[hora]!.mov.push(mov);
}
const primeira = outs.length ? String(outs[0]!.cycle_id) : "?";
const ultima = outs.length ? String(outs[outs.length - 1]!.cycle_id) : "?";

const rel = {
  limiares: { confAct: CONF_ACT, hostileTh: HOSTILE_TH },
  corpus: { decisoes: decs.length, validas: validos.length, estados_distintos: estadosDistintos.size, outcomes: outs.length },
  vocabulario: tokens,
  jev: { ...jev, actos: cont(jev.actos), conf: quantis(jev.confs) },
  dumb: { ...dumb, actos: cont(dumb.actos), conf: quantis(dumb.confs) },
  lados_dumb: ladosDumb,
  noul_hist: noulHist,
  noul_vs_choice: noulVsChoice,
  dir_after_por_hora: porHora,
  dir_after_janela: { de: primeira, ate: ultima },
};

// --------------------------------------------------------------------- relatório
const p = (x: unknown) => console.log("  " + x);
console.log(`V4b-0 (parte 1) — replay offline | gate conf>=${CONF_ACT}, hostile>=${HOSTILE_TH}`);
p(`corpus: ${validos.length} decisoes validas | ${estadosDistintos.size} estados distintos | ${outs.length} outcomes`);
console.log();
console.log("  VOCABULARIO DO ESTADO (posicao: palavras, por decisoes)");
for (const k of Object.keys(tokens).sort()) {
  const t = Object.entries(tokens[k]!).sort((a, b) => b[1] - a[1]);
  p(`${k}: ${t.map(([w, n]) => `${w}(${n})`).join(" ")}`);
}
console.log();
console.log("  LADO ESCOLHIDO, ANTES E DEPOIS DO GATE");
p(`jev  (gravado)    cru: ${JSON.stringify(cont(jev.actos))} | lados=${jev.sides} | n_lados=${jev.nLados} | bloqueados pelo gate=${jev.gated}`);
p(`dumb (recomputado) cru: ${JSON.stringify(cont(dumb.actos))} | lados=${dumb.sides} | n_lados=${dumb.nLados} | bloqueados pelo gate=${dumb.gated}`);
console.log();
if (ladosDumb.length) {
  console.log("  OS ESTADOS ONDE A dumb ESCOLHE LADO (e o que o jev fez no mesmo estado)");
  for (const l of ladosDumb.slice(0, 20)) p(`"${l.state}" -> dumb ${l.act} (conf ${l.conf}) | jev ${l.jevAct} | ${l.cycle}`);
  if (ladosDumb.length > 20) p(`... e mais ${ladosDumb.length - 20}`);
} else {
  p("OS ESTADOS ONDE A dumb ESCOLHE LADO: nenhum — o bucket `tape` nao disse pumping/dumping.");
}
console.log();
console.log("  noul (`too_hostile`) nos ciclos do jev");
for (const k of Object.keys(noulHist).sort()) p(`${k}: ${noulHist[k]}`);
console.log();
console.log("  noul vs escolha (o par que o documento pede)");
for (const k of Object.keys(noulVsChoice)) p(`${k}: ${JSON.stringify(noulVsChoice[k])}`);
console.log();
console.log("  dir_after POR HORA (o que o dono pediu)");
for (const k of Object.keys(porHora).sort()) {
  const h = porHora[k]!;
  p(`${k}: n=${h.total} dirs=${JSON.stringify(h.dirs)} | movimento mediana ${quantis(h.mov).p50!.toFixed(1)} bps`);
}
console.log();
const arg = process.argv.indexOf("--json");
if (arg > -1 && process.argv[arg + 1]) {
  writeFileSync(process.argv[arg + 1]!, JSON.stringify(rel, null, 1));
  p(`json: ${process.argv[arg + 1]}`);
}
