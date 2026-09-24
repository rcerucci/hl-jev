#!/usr/bin/env bun
/**
 * Pre-medicao do N1 — **READ-ONLY**: a janela de 300 s desta sessao da movimento suficiente
 * para o corte de 10 bps que a instrucao congela?
 *
 * Nao escreve nada no ledger e nao toca no produto. Existe porque o N1 tem dois cortes que se
 * MULTIPLICAM (EPS no sinal x |mov| >= 10 bps no rotulo) e a conta dos episodios pode dar zero
 * antes de se gastarem 3 h de sessao:
 *
 *   pontos elegiveis ~ n_janelas x P(ultima20 >= EPS) x P(|mov 300s| >= 10 bps)
 *
 * O segundo factor mede-se já, aqui, com as marcas publicas. O primeiro nao se reconstroi desta
 * fonte: as marcas vem de velas de **1 min**, e uma janela de 40 s cabe dentro da mesma vela —
 * e por isso que o `last20_bps` tem de ser PERSISTIDO no ledger (ponto 1 da instrucao).
 *
 * Uso: bun run provas/n1/pre-medicao.ts <cycle_id_fronteira> [nJanelas] [delayMs]
 */
import { Ledger } from "../../src/ledger/jsonl";
import { HlMarkSource } from "../../src/ledger/marks_source";
import { directionOf } from "../../src/ledger/outcome";

const desde = process.argv[2];
if (!desde) {
  console.error("uso: bun run provas/n1/pre-medicao.ts <cycle_id_fronteira> [nJanelas] [delayMs]");
  process.exit(2);
}
const nJanelas = Number(process.argv[3] ?? 40);
const delayMs = Number(process.argv[4] ?? 900);
const JANELA_MS = 300_000; // 300 s: o horizonte do N1

const ledger = new Ledger("data/ledger");
const marks = new HlMarkSource().marks;

// uma ancora por janela NAO sobreposta de 300 s, a partir da fronteira (a unidade do N1)
const dec = ledger.all()
  .filter(({ decision }) => decision.cycle_id >= desde)
  .map(({ sleeve, decision }) => ({ sleeve, decision }))
  .sort((a, b) => a.decision.ts - b.decision.ts);

const ancoras: typeof dec = [];
let proximo = 0;
for (const d of dec) {
  if (d.decision.ts < proximo) continue;
  ancoras.push(d);
  proximo = d.decision.ts + JANELA_MS;
}
// ancoras sem os ultimos 300 s (rotulo ainda nao vencido)
const agora = Date.now();
const elegiveis = ancoras.filter((a) => a.decision.ts + JANELA_MS <= agora).slice(0, nJanelas);

console.log(
  `  janela desde ${desde} · ${dec.length} ciclos · ${ancoras.length} ancoras de 300 s · ` +
    `${elegiveis.length} com rotulo vencido (de ${nJanelas} pedidas)`,
);
console.log(`  ${"ts".padEnd(9)} ${"|mov 300s| bps".padStart(14)}  dir_after  tape(ancora)`);

let ok = 0;
let sem = 0;
const movs: number[] = [];
const dirs: Record<string, number> = {};
let tapeNaoFlat = 0;
let tapeNaoFlatEComMov = 0;

for (const a of elegiveis) {
  const due = a.decision.ts + JANELA_MS;
  const m = await marks(a.sleeve, a.decision.ts, due);
  // `state` existe na linha crua do ledger mas nao no tipo `DecisionLine`: leia-se do registo.
  const estado = String((a.decision as unknown as { state?: string }).state ?? "");
  const tape = estado.split(" ")[3] ?? "?";
  if (m.then === null || m.plus === null || !(m.then > 0)) {
    sem++;
    console.log(`  ${a.decision.cycle_id.slice(9, 17).padEnd(9)} ${"SEM MARCA".padStart(14)}  ${"-".padEnd(10)}  ${tape}`);
    await Bun.sleep(delayMs);
    continue;
  }
  const bps = ((m.plus - m.then) / m.then) * 10_000;
  const dir = directionOf(m.then, m.plus, 10); // flat < 10 bps, o corte da instrucao
  ok++;
  movs.push(Math.abs(bps));
  dirs[dir] = (dirs[dir] ?? 0) + 1;
  if (tape !== "flat") tapeNaoFlat++;
  if (tape !== "flat" && Math.abs(bps) >= 10) tapeNaoFlatEComMov++;
  console.log(`  ${a.decision.cycle_id.slice(9, 17).padEnd(9)} ${Math.abs(bps).toFixed(1).padStart(14)}  ${dir.padEnd(10)}  ${tape}`);
  await Bun.sleep(delayMs);
}

const ordenado = [...movs].sort((x, y) => x - y);
const med = ordenado.length ? ordenado[Math.floor(ordenado.length / 2)] : 0;
const comMov = movs.filter((x) => x >= 10).length;

console.log();
console.log("  == DISTRIBUICAO (marcas publicas, formula do produto) ==");
console.log(`    amostras com marca ${ok} · sem marca ${sem}`);
console.log(
  `    |mov 300s| bps: min ${ordenado[0]?.toFixed(1) ?? "-"} · mediana ${med.toFixed(1)} · max ${ordenado[ordenado.length - 1]?.toFixed(1) ?? "-"}`,
);
console.log(`    >= 10 bps: ${comMov}/${ok} = ${ok ? ((100 * comMov) / ok).toFixed(1) : "-"}%   (o corte do rotulo)`);
console.log(`    dir_after: ${JSON.stringify(dirs)}`);
console.log();
console.log("  == VIABILIDADE DO N1 (os dois cortes multiplicam-se) ==");
console.log(
  `    P(tape != flat) nas ancoras = ${ancoras.length ? ((100 * tapeNaoFlat) / elegiveis.length).toFixed(1) : "-"}%` +
    `  (proxy de P(|last20| >= 4 bps))`,
);
console.log(`    ancoras com tape != flat E |mov| >= 10 bps: ${tapeNaoFlatEComMov}`);
console.log(
  `    projeccao: ${((comMov / (ok || 1)) * 100).toFixed(0)}% das janelas passam o corte do rotulo` +
    ` x ${ancoras.length ? ((100 * tapeNaoFlat) / elegiveis.length).toFixed(0) : "-"}% dos sinais com lado` +
    ` => ~${((comMov / (ok || 1)) * (tapeNaoFlat / (elegiveis.length || 1)) * 12).toFixed(1)} pontos elegiveis por hora de sessao`,
);
console.log();
console.log("  (read-only: nada foi escrito no ledger e o produto nao foi tocado)");
