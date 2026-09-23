import { expect, test } from "bun:test";
import type { DecisionLine, OutcomeLine } from "../src/ledger/jsonl";
import { MIN_HIGH_CONF, formatTable, summarise, verdictOf, winrate } from "../src/ledger/attribution";

const CONF = 0.8;
/** Amostra suficiente para o veredicto concluir (o minimo declarado + folga). */
const N = MIN_HIGH_CONF + 5;

function decision(model: string, act: string, conf: number): DecisionLine {
  return {
    kind: "decision",
    cycle_id: "20260923T120000Z-BTC",
    ts: Date.UTC(2026, 8, 23, 12, 0, 0),
    sleeve: "BTC",
    state: "normal deep two_way flat flat pay_neutral mid",
    verdict: { model, act, act_conf: conf },
    intent: { side: act, urgency: "maker" },
    fill: null,
  };
}

function outcome(hit: boolean | null, conf: number, miss = false): OutcomeLine {
  return {
    kind: "outcome",
    cycle_id: "20260923T120000Z-BTC",
    mark_then: 100,
    mark_plus_15m: hit ? 101 : 99,
    funding_accrued: 0.00001,
    dir_after: hit === null ? "flat" : hit ? "up" : "down",
    jev_side: "buy",
    directional_hit: hit,
    conf_was: conf,
    high_conf_miss: miss,
    horizon_secs: 900,
  };
}

const ciclo = (model: string, act: string, conf: number, out: OutcomeLine | null) => ({ decision: decision(model, act, conf), outcome: out });

test("a tabela separa Jev e controle pelo modelo do veredicto", () => {
  const stats = summarise(
    [
      ciclo("jev-1.13.0", "buy", 0.9, outcome(true, 0.9)),
      ciclo("jev-1.13.0", "buy", 0.9, outcome(false, 0.9, true)),
      ciclo("jev-1.13.0", "hold", 0.4, outcome(null, 0.4)),
      ciclo("dumb", "buy", 0.9, outcome(true, 0.9)),
      ciclo("dumb", "buy", 0.9, outcome(true, 0.9)),
    ],
    CONF,
  );
  const jev = stats.find((s) => s.policy === "jev-1.13.0")!;
  const dumb = stats.find((s) => s.policy === "dumb")!;
  expect(jev).toMatchObject({ cycles: 3, withOutcome: 3, holds: 1, highConf: 2, highConfHits: 1, highConfMisses: 1, highConfMissFlags: 1 });
  expect(winrate(jev)).toBeCloseTo(0.5, 6);
  expect(dumb).toMatchObject({ cycles: 2, highConf: 2, highConfHits: 2, highConfMisses: 0 });
  expect(winrate(dumb)).toBe(1);
  expect(jev.fundingAvg).toBeCloseTo(0.00001, 10);
});

test("hold e mercado parado ficam fora do denominador do acerto", () => {
  const stats = summarise(
    [
      ciclo("jev-1.13.0", "buy", 0.9, outcome(true, 0.9)),
      ciclo("jev-1.13.0", "hold", 0.95, outcome(null, 0.95)),
      ciclo("jev-1.13.0", "sell", 0.9, outcome(null, 0.9)),
    ],
    CONF,
  )[0]!;
  expect(stats.highConfHits + stats.highConfMisses).toBe(1);
  expect(stats.flats).toBe(2);
  expect(winrate(stats)).toBe(1);
});

test("ciclo sem outcome aparece na coluna, mas nao na conta do acerto", () => {
  const stats = summarise([ciclo("jev-1.13.0", "buy", 0.9, null)], CONF)[0]!;
  expect(stats).toMatchObject({ cycles: 1, withOutcome: 0, highConf: 1 });
  expect(winrate(stats)).toBe(null);
  expect(formatTable([stats])[2]).toContain("--");
});

test("com amostra pequena o veredicto recusa concluir", () => {
  const stats = summarise(
    [
      ciclo("jev-1.13.0", "buy", 0.9, outcome(true, 0.9)),
      ciclo("dumb", "buy", 0.9, outcome(true, 0.9)),
    ],
    CONF,
  );
  const lines = verdictOf(stats);
  expect(lines[0]).toContain("amostra insuficiente");
  expect(lines[0]).toContain(`minimo ${MIN_HIGH_CONF}`);
});

test("amostra suficiente: o Jev bate o controle", () => {
  const amostra: ReturnType<typeof ciclo>[] = [];
  for (let i = 0; i < N; i++) amostra.push(ciclo("jev-1.13.0", "buy", 0.9, outcome(true, 0.9)));
  for (let i = 0; i < N; i++) amostra.push(ciclo("dumb", "buy", 0.9, outcome(i === 0, 0.9)));
  const stats = summarise(amostra, CONF);
  expect(verdictOf(stats)[0]).toContain("o Jev bate o controle");
});

test("amostra suficiente: controle empata ou ganha proibe noite e mainnet", () => {
  const amostra: ReturnType<typeof ciclo>[] = [];
  for (let i = 0; i < N; i++) amostra.push(ciclo("jev-1.13.0", "buy", 0.9, outcome(true, 0.9)));
  for (let i = 0; i < N; i++) amostra.push(ciclo("dumb", "buy", 0.9, outcome(true, 0.9)));
  const stats = summarise(amostra, CONF);
  const lines = verdictOf(stats);
  expect(lines[0]).toContain("empata ou ganha");
  expect(lines[1]).toContain("NAO ligar a noite");
});

test("sem uma das colunas o veredicto diz o que falta em vez de inventar", () => {
  const soJev = summarise([ciclo("jev-1.13.0", "buy", 0.9, outcome(true, 0.9))], CONF);
  expect(verdictOf(soJev)[0]).toContain("falta uma das colunas");
});

test("a tabela imprime o limiar e as colunas da spec 9.4", () => {
  const stats = summarise([ciclo("jev-1.13.0", "buy", 0.9, outcome(true, 0.9))], CONF);
  const out = formatTable(stats).join("\n");
  expect(out).toContain("limiar de confianca: 0.8");
  for (const col of ["ciclos", "c/outcome", "%hold", "%conf>=limiar", "acuerto", "funding"]) {
    expect(out).toContain(col);
  }
});
