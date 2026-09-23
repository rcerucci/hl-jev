/**
 * A caixa LEDGER, segunda metade: o outcome (+15 min) e o worker que o escreve.
 *
 * Spec 3.8 / 6: quem escreve `outcome` e um processo **separado** que acorda
 * depois do horizonte; o tick nao bloqueia a espera do futuro. Duas escritas por
 * ciclo, o mesmo `cycle_id`, no ficheiro do dia da **decisao** (D5) — por isso
 * este modulo reconstroi tudo a partir do ledger mais as marcas do venue, e
 * pode ser re-corrido: passar duas vezes nao duplica nada (idempotente), e um
 * ciclo antigo pode ser preenchido mais tarde (backfill).
 *
 * O que ele **nao** faz: inventar marca. Sem vela para a hora pedida, o ciclo
 * fica pendente para a passagem seguinte.
 *
 * Uso: `bun run src/ledger/outcome.ts`
 */
import { config } from "../config";
import { HlMarkSource, type Marks, type MarkSource } from "./marks_source";
import { Ledger, type DecisionLine, type OutcomeLine } from "./jsonl";

/** Abaixo disto o mercado nao andou: nao ha direcao para acertar ou errar. */
export const OUTCOME = { FLAT_BPS: 0.5 } as const;

export interface OutcomePass {
  ledger: Ledger;
  marks: MarkSource;
  now: number;
  horizonSecs?: number;
  confAct?: number;
  /** Respiro entre pedidos ao venue (cortesia com o endpoint publico). */
  delayMs?: number;
}

export interface OutcomeReport {
  written: number;
  pending: number;
  skipped: number;
  bySleeve: Record<string, number>;
}

export interface VerdictShape {
  act: string;
  act_conf: number;
}

/** Le so o que a atribuicao precisa. Veredicto ilegivel nao vira atribuicao. */
export function readVerdict(line: DecisionLine): VerdictShape | null {
  const v = line.verdict as { act?: unknown; act_conf?: unknown } | null;
  if (!v || typeof v.act !== "string" || typeof v.act_conf !== "number" || !Number.isFinite(v.act_conf)) return null;
  return { act: v.act, act_conf: v.act_conf };
}

export function directionOf(then: number, plus: number, flatBps = OUTCOME.FLAT_BPS): "up" | "down" | "flat" {
  if (!(then > 0)) return "flat";
  const bps = ((plus - then) / then) * 10_000;
  if (Math.abs(bps) < flatBps) return "flat";
  return bps > 0 ? "up" : "down";
}

/**
 * A linha do outcome (spec 3.8). `directional_hit` e `null` quando o Jev disse
 * `hold` (nao ha lado) ou quando o mercado nao andou (nao ha direcao): contar um
 * movimento nulo como acerto inflaria a tabela, e como erro inflaria os
 * `high_conf_miss` que a noite le. Fica de fora, declarado.
 */
export function outcomeFor(
  line: DecisionLine,
  marks: Marks,
  horizonSecs = config.outcomeHorizonSecs,
  confAct = config.confAct,
): OutcomeLine | null {
  const verdict = readVerdict(line);
  if (!verdict || marks.then === null || marks.plus === null) return null;
  const dir = directionOf(marks.then, marks.plus);
  const side = verdict.act === "buy" || verdict.act === "sell" ? verdict.act : null;
  const hit = side === null || dir === "flat" ? null : side === "buy" ? dir === "up" : dir === "down";
  return {
    kind: "outcome",
    cycle_id: line.cycle_id,
    mark_then: marks.then,
    mark_plus_15m: marks.plus,
    funding_accrued: marks.funding,
    dir_after: dir,
    jev_side: verdict.act,
    directional_hit: hit,
    conf_was: verdict.act_conf,
    high_conf_miss: hit === false && verdict.act_conf >= confAct,
    horizon_secs: horizonSecs,
  };
}

/** Uma passagem: escreve os outcomes vencidos que ainda nao existem. */
export async function runOutcomes(pass: OutcomePass): Promise<OutcomeReport> {
  const horizonSecs = pass.horizonSecs ?? config.outcomeHorizonSecs;
  const report: OutcomeReport = { written: 0, pending: 0, skipped: 0, bySleeve: {} };
  for (const { sleeve, decision, outcome } of pass.ledger.all()) {
    if (outcome) continue;
    const due = decision.ts + horizonSecs * 1000;
    if (pass.now < due) {
      report.pending++;
      continue;
    }
    const marks = await pass.marks(sleeve, decision.ts, due);
    const line = outcomeFor(decision, marks, horizonSecs, pass.confAct);
    if (!line) {
      report.skipped++;
      continue;
    }
    pass.ledger.writeOutcome(line);
    report.written++;
    report.bySleeve[sleeve] = (report.bySleeve[sleeve] ?? 0) + 1;
    if (pass.delayMs) await Bun.sleep(pass.delayMs);
  }
  return report;
}

if (import.meta.main) {
  const ledger = new Ledger(config.ledgerDir);
  if (!ledger.all().length) {
    console.log(`sem ciclos em ${config.ledgerDir}`);
  } else {
    const report = await runOutcomes({ ledger, marks: new HlMarkSource().marks, now: Date.now(), delayMs: 120 });
    console.log(
      `outcome · escritos ${report.written} · pendentes ${report.pending} · sem marca ${report.skipped} · horizonte ${config.outcomeHorizonSecs}s`,
    );
    for (const [sleeve, n] of Object.entries(report.bySleeve)) console.log(`  ${sleeve}: ${n}`);
  }
}
