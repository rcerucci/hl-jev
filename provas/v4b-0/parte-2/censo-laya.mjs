// V4b-0 parte 2 — censo: a Laya nos MESMOS estados gravados.
//
// Corre da pasta de trabalho (a que tem o node_modules com @receptron/laya).
// Uso: node censo-laya.mjs <caminho do ledger> <out.json> [--n 3144]
//
// Regras deste censo (PLANO.md desta pasta):
//  - âmbito determinístico: as PRIMEIRAS N decisões válidas do ledger (o conjunto do snapshot);
//  - as MESMAS perguntas do policy/jev_questions.json (drop-in), com a tradução noul->choice
//    APENAS aqui, no cliente (assimetria declarada);
//  - nada de src/, nada de produto: só lê o ledger.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { Laya } from "@receptron/laya";

const LEDGER = process.argv[2] ?? "data/ledger";
const OUT = process.argv[3] ?? "censo-laya.json";
const N = Number(process.argv[4] ?? 3144);

// ---------------------------------------------------------------- perguntas (as do policy)
const PERGUNTAS = {
  act: {
    type: "choice",
    instructions: {
      question: "buy, sell, or hold BTC?",
      goal: "One maker quote for this book and this inventory. hold means no new order.",
      timing: "one decision per tick",
      inputs:
        "state is a short line of adjectives in a fixed order: spread depth flow tape inventory funding clock. inventory is mid.",
      context: "size, price, time in force and leverage are chosen by the code, never by you.",
    },
    criteria: {
      buy: "Maker edge to lift or cover a short without chasing a violent tape.",
      sell: "Maker edge to hit or reduce a long without chasing a dump.",
      hold: "No edge, hostile book, or inventory already expresses the view.",
    },
  },
  too_hostile: {
    type: "noul",
    instructions: {
      question: "Is this book too hostile to send any non-reduce order?",
      inputs: "state is the same short line of adjectives. inventory is mid.",
      context: "Answer yes only for a book where a resting quote would be obvious food.",
    },
    criteria: {
      true: "Unfillable book, bot_war plus violent tape, or funding extreme against the would-be add.",
      false: "A resting post-only quote can be placed without being obvious food.",
    },
  },
  // Tradução da primitiva: a MESMA pergunta, como choice de 2 opções com rótulos neutros
  // (a #156 é sobre rótulos true/false e yes/no colarem o noul).
  too_hostile_neutro: {
    type: "choice",
    instructions: {
      question: "Is this book too hostile to send any non-reduce order?",
      inputs: "state is the same short line of adjectives. inventory is mid.",
      context: "Answer with the option that matches: A for yes, B for no.",
    },
    criteria: {
      A: "Yes: unfillable book, bot_war plus violent tape, or funding extreme against the would-be add.",
      B: "No: a resting post-only quote can be placed without being obvious food.",
    },
  },
};

// ------------------------------------------------------------------------- âmbito
function linhas(dir) {
  const out = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort()) {
    for (const l of readFileSync(`${dir}/${f}`, "utf8").split("\n")) if (l.trim()) out.push(JSON.parse(l));
  }
  return out;
}

const rows = linhas(LEDGER);
const validas = rows.filter((r) => r.kind === "decision" && r.verdict && r.verdict.raw_ok !== false).slice(0, N);
if (validas.length < N) console.error(`  AVISO: ledger só tem ${validas.length} decisões válidas (< ${N})`);

const freq = new Map();
for (const r of validas) freq.set(r.state, (freq.get(r.state) ?? 0) + 1);
const estados = [...freq.keys()].sort();
console.error(`  âmbito: ${validas.length} decisões válidas | ${estados.length} estados distintos`);

// os 6 estados em que o dumb escolheu lado (do §14) — para a comparação directa
const dumbLado = (s) => {
  const t = s.split(/\s+/);
  return t.includes("pumping") ? "buy" : t.includes("dumping") ? "sell" : null;
};

// ------------------------------------------------------------------------ censo
const t0 = Date.now();
const laya = await Laya.load({
  // 2b: apontar para o bundle exportado (typed-decisions) sem tocar no resto da sonda.
  ...(process.env.LAYA_MODEL_DIR ? { modelDir: process.env.LAYA_MODEL_DIR } : {}),
  executionProviders: ["cpu"],
  sessionOptions: { intraOpNumThreads: 4 },
});
const carga_ms = Date.now() - t0;

const porEstado = [];
const lat = [];
for (const s of estados) {
  const t = Date.now();
  const r = await laya.systemOne(s, PERGUNTAS);
  lat.push(Date.now() - t);
  const a = r.answers;
  porEstado.push({
    estado: s,
    ciclos: freq.get(s),
    act: a.act.choice,
    act_conf: a.act.probabilities[a.act.choice],
    act_probs: a.act.probabilities,
    noul: a.too_hostile.noul,
    neutro_A: a.too_hostile_neutro.probabilities.A,
    neutro_choice: a.too_hostile_neutro.choice,
    tokens: r.usage?.input_tokens ?? null,
    dumb: dumbLado(s),
  });
}
await laya.close();

const soma = (xs) => xs.reduce((a, b) => a + b, 0);
const q = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.round((p / 100) * (xs.length - 1)))];

const pesoAct = {};
const pesoNoul = { ">= 0.65": 0, "< 0.65": 0 };
let ladosPonderados = 0;
let ladosEstados = 0;
for (const e of porEstado) {
  pesoAct[e.act] = (pesoAct[e.act] ?? 0) + e.ciclos;
  pesoNoul[e.noul >= 0.65 ? ">= 0.65" : "< 0.65"] += e.ciclos;
  if (e.act === "buy" || e.act === "sell") {
    ladosPonderados += e.ciclos;
    ladosEstados++;
  }
}

const rel = {
  checkpoint: "ingles publicado (receptron/laya-onnx) — PRE-ENSAIO, nao e o checkpoint do vivo",
  ambito: { decisoes: validas.length, estados: estados.length },
  carga_ms,
  latencia_ms: { p50: q(lat, 50), p95: q(lat, 95), max: Math.max(...lat) },
  act_por_ciclo: pesoAct,
  act_por_estado: porEstado.reduce((a, e) => ((a[e.act] = (a[e.act] ?? 0) + 1), a), {}),
  lados: { ponderados_por_ciclo: ladosPonderados, estados: ladosEstados },
  noul_por_ciclo: pesoNoul,
  neutro_por_ciclo: porEstado.reduce((a, e) => ((a[e.neutro_choice] = (a[e.neutro_choice] ?? 0) + e.ciclos), a), {}),
  por_estado: porEstado,
};
writeFileSync(OUT, JSON.stringify(rel, null, 1));

console.log(`\n  checkpoint: ${rel.checkpoint}`);
console.log(`  carga: ${carga_ms} ms | latência por estado: p50 ${rel.latencia_ms.p50} · p95 ${rel.latencia_ms.p95} · max ${rel.latencia_ms.max} ms`);
console.log(`  act (ponderado por ciclo de ${validas.length}): ${JSON.stringify(pesoAct)}`);
console.log(`  act (por estado de ${estados.length}): ${JSON.stringify(rel.act_por_estado)}`);
console.log(`  LADOS: ${ladosPonderados} ciclos em ${ladosEstados} estados`);
console.log(`  noul por ciclo: ${JSON.stringify(pesoNoul)}`);
console.log(`  too_hostile neutro (choice A/B) por ciclo: ${JSON.stringify(rel.neutro_por_ciclo)}`);
console.log(`\n  estados onde o dumb escolhe lado — o que a Laya diz no mesmo estado:`);
for (const e of porEstado.filter((e) => e.dumb)) {
  console.log(
    `    "${e.estado}" (${e.ciclos}×)\n      dumb ${e.dumb} | Laya ${e.act} (conf ${e.act_conf.toFixed(3)}) | noul ${e.noul.toFixed(3)} | A ${e.neutro_A.toFixed(3)}`,
  );
}
console.log(`\n  json: ${OUT}`);
