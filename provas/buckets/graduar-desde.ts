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
 * Uso: bun run provas/buckets/graduar-desde.ts <cycle_id_minimo> [limite] [delayMs]
 */
import { config } from "../../src/config";
import { Ledger } from "../../src/ledger/jsonl";
import { HlMarkSource } from "../../src/ledger/marks_source";
import { outcomeFor } from "../../src/ledger/outcome";

const desde = process.argv[2];
if (!desde) {
  console.error("uso: bun run provas/buckets/graduar-desde.ts <cycle_id_minimo> [limite] [delayMs]");
  process.exit(2);
}
const limite = Number(process.argv[3] ?? 400);
const delayMs = Number(process.argv[4] ?? 1200);

const ledger = new Ledger(config.ledgerDir);
const marks = new HlMarkSource().marks;
const agora = Date.now();

let escritos = 0;
let pendentes = 0;
let semMarca = 0;
let candidatos = 0;

for (const { sleeve, decision, outcome } of ledger.all()) {
  if (outcome) continue;
  if (decision.cycle_id < desde) continue;
  const due = decision.ts + config.outcomeHorizonSecs * 1000;
  if (agora < due) {
    pendentes++;
    continue;
  }
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
  await Bun.sleep(delayMs);
}

console.log(
  `graduados ${escritos} · pendentes ${pendentes} · sem marca ${semMarca} · limite ${limite} · delay ${delayMs}ms · desde ${desde}`,
);
