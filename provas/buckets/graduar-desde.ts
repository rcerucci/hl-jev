#!/usr/bin/env bun
/**
 * Gradúa os outcomes de uma JANELA do ledger, para o ensaio de buckets.
 *
 * Porque existe: o worker do produto (`src/ledger/outcome.ts`) não tem filtro — percorre o ledger do
 * mais antigo para o mais novo e morre no 429/CDN a meio, portanto nunca chega aos ciclos da sessão
 * nova. Isto **não reimplementa nada**: importa as mesmas funções do produto (`Ledger`, `outcomeFor`,
 * `HlMarkSource`) e só acrescenta o filtro e um espaçamento maior entre pedidos.
 *
 * Idempotente como o worker: só escreve ciclos sem outcome; um ciclo sem vela fica pendente.
 *
 * Uso: bun run provas/buckets/graduar-desde.ts <cycle_id_minimo> [limite] [delayMs] [--independentes]
 *
 * `--independentes` gradua so uma ANCORA a cada 900 s dentro da janela: e o que o criterio da
 * regra 4 precisa. Graduar 700 ciclos seguidos da 23 min de sessao, e as suas janelas de 15 min
 * sobrepoem-se quase todas — seriam 2 observacoes, nao 700.
 */
import { config } from "../../src/config";
import { Ledger } from "../../src/ledger/jsonl";
import { HlMarkSource } from "../../src/ledger/marks_source";
import { outcomeFor } from "../../src/ledger/outcome";

const desde = process.argv[2];
if (!desde) {
  console.error("uso: bun run provas/buckets/graduar-desde.ts <cycle_id_minimo> [limite] [delayMs] [--independentes]");
  process.exit(2);
}
const limite = Number(process.argv[3] ?? 400);
const delayMs = Number(process.argv[4] ?? 1200);
const soAncoras = process.argv.includes("--independentes");

const ledger = new Ledger(config.ledgerDir);
const marks = new HlMarkSource().marks;
const agora = Date.now();

let escritos = 0;
let pendentes = 0;
let semMarca = 0;
let candidatos = 0;

// Ja graduado dentro da janela conta como ancora: assim um segundo arranque nao grava
// uma ancora a um minuto da anterior.
let ultimaAncora: number | null = null;
for (const { decision, outcome } of ledger.all()) {
  if (decision.cycle_id < desde) continue;
  if (outcome && (ultimaAncora === null || decision.ts > ultimaAncora)) ultimaAncora = decision.ts;
}

for (const { sleeve, decision, outcome } of ledger.all()) {
  if (outcome) continue;
  if (decision.cycle_id < desde) continue;
  const due = decision.ts + config.outcomeHorizonSecs * 1000;
  if (agora < due) {
    pendentes++;
    continue;
  }
  if (soAncoras && ultimaAncora !== null && decision.ts - ultimaAncora < 900_000) continue;
  if (candidatos >= limite) break;
  candidatos++;
  const m = await marks(sleeve, decision.ts, due);
  const line = outcomeFor(decision, m, config.outcomeHorizonSecs, config.confAct);
  if (!line) {
    semMarca++;
    continue;
  }
  ledger.writeOutcome(line);
  escritos++;
  ultimaAncora = decision.ts;
  await Bun.sleep(delayMs);
}

console.log(
  `graduados ${escritos} · pendentes ${pendentes} · sem marca ${semMarca} · limite ${limite}` +
    ` · delay ${delayMs}ms · desde ${desde}${soAncoras ? " · SO ANCORAS (>=900 s)" : ""}`,
);
