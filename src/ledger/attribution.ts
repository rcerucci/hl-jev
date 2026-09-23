/**
 * A caixa LEDGER, terceira parte: a tabela de atribuicao (spec 9.4 e 10-C).
 *
 * Le o ledger e responde: com a mesma `state`, o Jev acerta mais do que uma
 * heuristica burra sobre as mesmas palavras? A coluna de controle ja esta no
 * ledger — `POLICY=dumb` escreve o mesmo schema —, e o que separa as duas e o
 * `verdict.model` de cada linha ("jev-1.13.0" vs "dumb").
 *
 * Regra da spec 9.4: se o controle empatar ou ganhar, **nao** ligar a noite nem
 * ir a mainnet. O script diz isso em voz alta, e recusa concluir com amostra
 * pequena em vez de dar um numero bonito.
 *
 * Uso: `bun run src/ledger/attribution.ts`
 */
import { config } from "../config";
import { Ledger, type DecisionLine, type OutcomeLine } from "./jsonl";

/** Abaixo disto nao se conclui nada: so se declara a amostra. */
export const MIN_HIGH_CONF = 20;

export interface PolicyStats {
  policy: string;
  cycles: number;
  withOutcome: number;
  holds: number;
  highConf: number;
  highConfHits: number;
  highConfMisses: number;
  /** Outcomes com direcao definida mas fora do limiar de confianca. */
  lowConfGraded: number;
  /** Movimento nulo: nao conta como acerto nem como erro. */
  flats: number;
  highConfMissFlags: number;
  fundingAvg: number | null;
}

interface Sample {
  decision: DecisionLine;
  outcome: OutcomeLine | null;
}

function policyOf(line: DecisionLine): string {
  const v = line.verdict as { model?: unknown } | null;
  return v && typeof v.model === "string" && v.model ? v.model : "(sem modelo)";
}

/** Le o par acao/confianca de uma linha de decisao. */
function readVerdictOf(line: DecisionLine): { act: string; conf: number } | null {
  const v = line.verdict as { act?: unknown; act_conf?: unknown } | null;
  if (!v || typeof v.act !== "string" || typeof v.act_conf !== "number") return null;
  return { act: v.act, conf: v.act_conf };
}

export function summarise(samples: Sample[], confAct = config.confAct): PolicyStats[] {
  const byPolicy = new Map<string, PolicyStats>();
  for (const { decision, outcome } of samples) {
    const policy = policyOf(decision);
    const stats = byPolicy.get(policy) ?? {
      policy,
      cycles: 0,
      withOutcome: 0,
      holds: 0,
      highConf: 0,
      highConfHits: 0,
      highConfMisses: 0,
      lowConfGraded: 0,
      flats: 0,
      highConfMissFlags: 0,
      fundingAvg: null,
    };
    stats.cycles++;
    const verdict = readVerdictOf(decision);
    if (verdict) {
      if (verdict.act === "hold") stats.holds++;
      if (verdict.conf >= confAct) stats.highConf++;
    }
    if (outcome) {
      stats.withOutcome++;
      const rated = outcome.directional_hit;
      const conf = outcome.conf_was ?? 0;
      const high = conf >= confAct;
      if (rated === null) stats.flats++;
      else if (high) rated ? stats.highConfHits++ : stats.highConfMisses++;
      else stats.lowConfGraded++;
      if (outcome.high_conf_miss) stats.highConfMissFlags++;
      if (typeof outcome.funding_accrued === "number") {
        const n = stats.withOutcome;
        stats.fundingAvg = ((stats.fundingAvg ?? 0) * (n - 1) + outcome.funding_accrued) / n;
      }
    }
    byPolicy.set(policy, stats);
  }
  return [...byPolicy.values()].sort((a, b) => b.cycles - a.cycles);
}

export function winrate(stats: PolicyStats): number | null {
  const n = stats.highConfHits + stats.highConfMisses;
  return n > 0 ? stats.highConfHits / n : null;
}

const pct = (x: number | null) => (x === null ? "  --" : `${(x * 100).toFixed(1)}%`);
const pad = (s: string, w: number) => s.padEnd(w);

export function formatTable(stats: PolicyStats[], confAct = config.confAct): string[] {
  const head = [
    pad("politica", 12),
    pad("ciclos", 8),
    pad("c/outcome", 10),
    pad("%hold", 8),
    pad("%conf>=limiar", 15),
    pad("acuerto", 9),
    pad("n", 5),
    pad("nulos", 7),
    pad("hits_altaconf", 15),
    pad("funding", 10),
  ].join("");
  const rows = stats.map((s) =>
    [
      pad(s.policy, 12),
      pad(String(s.cycles), 8),
      pad(String(s.withOutcome), 10),
      pad(s.cycles ? ((s.holds / s.cycles) * 100).toFixed(1) + "%" : "--", 8),
      pad(s.cycles ? ((s.highConf / s.cycles) * 100).toFixed(1) + "%" : "--", 15),
      pad(pct(winrate(s)), 9),
      pad(String(s.highConfHits + s.highConfMisses), 5),
      pad(String(s.flats), 7),
      pad(String(s.highConfMissFlags), 15),
      pad(s.fundingAvg === null ? "--" : s.fundingAvg.toExponential(2), 10),
    ].join(""),
  );
  return [`limiar de confianca: ${confAct}`, head, ...rows];
}

/**
 * Veredicto da spec 9.4, com a amostra declarada. Nunca da um numero sem o n.
 */
export function verdictOf(stats: PolicyStats[], minN = MIN_HIGH_CONF): string[] {
  const jev = stats.find((s) => /^jev/i.test(s.policy));
  const dumb = stats.find((s) => /^dumb/i.test(s.policy));
  if (!jev || !dumb) {
    return ["veredicto: falta uma das colunas (roda tambem com POLICY=dumb ou POLICY=jev) — nao ha comparacao."];
  }
  const nj = jev.highConfHits + jev.highConfMisses;
  const nd = dumb.highConfHits + dumb.highConfMisses;
  if (nj < minN || nd < minN) {
    return [
      `veredicto: amostra insuficiente (Jev n=${nj}, controle n=${nd}, minimo ${minN}) — nao se conclui nada daqui.`,
      "o que fazer: mais ciclos com alta confianca, ou baixar o limiar com motivo escrito.",
    ];
  }
  const wj = winrate(jev)!;
  const wd = winrate(dumb)!;
  if (wj > wd) return [`veredicto: o Jev bate o controle (${pct(wj)} vs ${pct(wd)}, n=${nj}/${nd}).`];
  return [
    `veredicto: o controle empata ou ganha (${pct(wd)} vs ${pct(wj)}, n=${nd}/${nj}).`,
    "consequencia (spec 9.4): NAO ligar a noite e NAO ir a mainnet. O encaixe mecanico esta bom; o oraculo nao.",
  ];
}

if (import.meta.main) {
  const ledger = new Ledger(config.ledgerDir);
  const samples = ledger.all();
  if (!samples.length) {
    console.log(`sem ciclos em ${config.ledgerDir}`);
  } else {
    const stats = summarise(samples);
    for (const line of formatTable(stats)) console.log(line);
    console.log("");
    for (const line of verdictOf(stats)) console.log(line);
  }
}
