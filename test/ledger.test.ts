import { afterAll, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { Ledger, cycleId, dayOfCycle, sleeveOfCycle, type DecisionLine, type OutcomeLine } from "../src/ledger/jsonl";

const DIR = "./data/test-ledger";
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const decision = (id: string): DecisionLine => ({
  kind: "decision",
  cycle_id: id,
  ts: Date.now(),
  sleeve: sleeveOfCycle(id),
  state: "normal ok quiet flat flat pay_neutral mid",
  verdict: { act: "buy", act_conf: 0.86 },
  intent: { side: "buy", urgency: "maker" },
  fill: null,
});

const outcome = (id: string): OutcomeLine => ({
  kind: "outcome",
  cycle_id: id,
  mark_then: 187.21,
  mark_plus_15m: 188.02,
  funding_accrued: 0.000004,
  dir_after: "up",
  jev_side: "buy",
  directional_hit: true,
  conf_was: 0.86,
  high_conf_miss: false,
});

test("o cycle_id carrega o instante UTC e o sleeve", () => {
  const at = new Date(Date.UTC(2026, 8, 23, 12, 30, 15));
  const id = cycleId(at, "sol");
  expect(id).toBe("20260923T123015Z-SOL");
  expect(dayOfCycle(id)).toBe("20260923");
  expect(sleeveOfCycle(id)).toBe("SOL");
  expect(() => dayOfCycle("sem-dia")).toThrow();
});

test("duas linhas por ciclo, o mesmo cycle_id, juncao por id", () => {
  const led = new Ledger(DIR);
  const id = cycleId(new Date(Date.UTC(2026, 8, 23, 12, 30, 15)), "SOL");
  led.writeDecision(decision(id));
  led.writeOutcome(outcome(id));
  const cycles = led.cycles("SOL", "20260923");
  expect(cycles.length).toBe(1);
  expect(cycles[0]!.decision.cycle_id).toBe(id);
  expect(cycles[0]!.outcome?.directional_hit).toBe(true);
});

test("o outcome de uma decisao das 23:50 fica no ficheiro do dia da DECISAO", () => {
  const led = new Ledger(DIR);
  const id = cycleId(new Date(Date.UTC(2026, 8, 23, 23, 50, 0)), "ETH");
  led.writeDecision(decision(id));
  // O worker acorda 15 minutos depois, ja no dia seguinte, e escreve com o mesmo id.
  led.writeOutcome(outcome(id));
  expect(dayOfCycle(id)).toBe("20260923");
  const doDia = led.cycles("ETH", "20260923");
  expect(doDia.length).toBe(1);
  expect(doDia[0]!.outcome).not.toBeNull();
  // Nada foi escrito no dia seguinte.
  expect(led.read("ETH", "20260924").length).toBe(0);
});

test("append-only: escrever de novo acrescenta em vez de reescrever", () => {
  const led = new Ledger(DIR);
  const id = cycleId(new Date(Date.UTC(2026, 8, 23, 12, 31, 0)), "DOGE");
  led.writeDecision(decision(id));
  led.writeDecision(decision(id));
  expect(led.read("DOGE", "20260923").length).toBe(2);
});

test("ficheiro por sleeve: o ledger de uma nao ve a outra", () => {
  const led = new Ledger(DIR);
  const bnb = cycleId(new Date(Date.UTC(2026, 8, 23, 12, 32, 0)), "BNB");
  led.writeDecision(decision(bnb));
  expect(led.read("BNB", "20260923").length).toBe(1);
  expect(led.read("SOL", "20260923").some((l) => l.cycle_id === bnb)).toBe(false);
});

test("nenhuma linha do ledger carrega chave", () => {
  const led = new Ledger(DIR);
  const all = led.read("SOL", "20260923").map((l) => JSON.stringify(l)).join("\n");
  expect(all).not.toMatch(/privateKey|0x[a-fA-F0-9]{40,}/);
});
