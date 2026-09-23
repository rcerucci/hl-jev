import { afterAll, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { Ledger, cycleId, dayOfCycle, type DecisionLine } from "../src/ledger/jsonl";
import { CANDLE_MS, closeAt, sumFunding, type MarkSource } from "../src/ledger/marks_source";
import { OUTCOME, directionOf, outcomeFor, readVerdict, runOutcomes } from "../src/ledger/outcome";

const DIR = "./data/test-outcome";
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const HORIZON = 900;
const T0 = Date.UTC(2026, 8, 23, 12, 0, 0);
const CONF_ACT = 0.8;

function decision(ts: number, act: string, conf: number, sleeve = "BTC"): DecisionLine {
  return {
    kind: "decision",
    cycle_id: cycleId(new Date(ts), sleeve),
    ts,
    sleeve,
    state: "normal deep two_way flat flat pay_neutral mid",
    verdict: { model: "jev-1.13.0", act, act_conf: conf, too_hostile: 0.1, raw_ok: true },
    intent: { side: act, urgency: act === "hold" ? "none" : "maker", reduce_only: false, conf, reason: "jev_act" },
    fill: null,
  };
}

const marks = (then: number | null, plus: number | null, funding: number | null = 0) => async () => ({ then, plus, funding });

test("directionOf separa subida, descida e mercado parado", () => {
  expect(directionOf(100, 101)).toBe("up");
  expect(directionOf(100, 99)).toBe("down");
  expect(directionOf(100, 100)).toBe("flat");
  // 0,2 bps de ruido nao e direcao
  expect(directionOf(100, 100.002)).toBe("flat");
  expect(directionOf(100, 100.01)).toBe("up");
  expect(directionOf(0, 100)).toBe("flat");
  expect(OUTCOME.FLAT_BPS).toBe(0.5);
});

test("um lado certo e um acerto; o lado trocado e um erro", () => {
  const up = outcomeFor(decision(T0, "buy", 0.9), { then: 100, plus: 101, funding: 0 }, HORIZON, CONF_ACT);
  expect(up).toMatchObject({ directional_hit: true, dir_after: "up", high_conf_miss: false, horizon_secs: HORIZON });
  const down = outcomeFor(decision(T0, "buy", 0.9), { then: 100, plus: 99, funding: 0 }, HORIZON, CONF_ACT);
  expect(down).toMatchObject({ directional_hit: false, dir_after: "down", high_conf_miss: true });
  const sell = outcomeFor(decision(T0, "sell", 0.9), { then: 100, plus: 99, funding: 0 }, HORIZON, CONF_ACT);
  expect(sell).toMatchObject({ directional_hit: true, high_conf_miss: false });
});

test("erro com confianca baixa NAO e high_conf_miss", () => {
  const line = outcomeFor(decision(T0, "buy", 0.35), { then: 100, plus: 99, funding: 0 }, HORIZON, CONF_ACT);
  expect(line).toMatchObject({ directional_hit: false, high_conf_miss: false });
});

test("hold e mercado parado nao contam como acerto nem como erro", () => {
  const hold = outcomeFor(decision(T0, "hold", 0.9), { then: 100, plus: 101, funding: 0 }, HORIZON, CONF_ACT);
  expect(hold).toMatchObject({ directional_hit: null, dir_after: "up", high_conf_miss: false });
  const flat = outcomeFor(decision(T0, "buy", 0.9), { then: 100, plus: 100, funding: 0 }, HORIZON, CONF_ACT);
  expect(flat).toMatchObject({ directional_hit: null, dir_after: "flat", high_conf_miss: false });
});

test("sem marca o outcome nao existe: nada e inventado", () => {
  expect(outcomeFor(decision(T0, "buy", 0.9), { then: null, plus: 101, funding: 0 }, HORIZON, CONF_ACT)).toBe(null);
  expect(outcomeFor(decision(T0, "buy", 0.9), { then: 100, plus: null, funding: 0 }, HORIZON, CONF_ACT)).toBe(null);
});

test("veredicto ilegivel nao vira atribuicao", () => {
  const semVeredicto = { ...decision(T0, "buy", 0.9), verdict: { nada: true } };
  expect(readVerdict(semVeredicto)).toBe(null);
  expect(outcomeFor(semVeredicto, { then: 100, plus: 101, funding: 0 }, HORIZON, CONF_ACT)).toBe(null);
  const confTexto = { ...decision(T0, "buy", 0.9), verdict: { act: "buy", act_conf: "0.9" } };
  expect(readVerdict(confTexto)).toBe(null);
});

test("o worker escreve o outcome no ficheiro do dia da DECISAO e nao duplica", async () => {
  const led = new Ledger(`${DIR}/pass`);
  const dias = [T0, T0 + 60_000, T0 + 120_000];
  for (const ts of dias) led.writeDecision(decision(ts, "buy", 0.9));
  const source: MarkSource = marks(100, 101);
  // Depois do horizonte do ultimo ciclo: antes disso o worker tem de os deixar pendentes.
  const now = T0 + 120_000 + HORIZON * 1000 + 1000;

  const first = await runOutcomes({ ledger: led, marks: source, now, horizonSecs: HORIZON, confAct: CONF_ACT });
  expect(first.written).toBe(3);
  expect(first.pending).toBe(0);
  expect(first.skipped).toBe(0);
  expect(first.bySleeve).toEqual({ BTC: 3 });

  const second = await runOutcomes({ ledger: led, marks: source, now, horizonSecs: HORIZON, confAct: CONF_ACT });
  expect(second.written).toBe(0);

  // duas linhas por ciclo, o mesmo cycle_id, no ficheiro do dia da decisao
  const day = dayOfCycle(cycleId(new Date(T0), "BTC"));
  const lines = led.read("BTC", day);
  expect(lines.filter((l) => l.kind === "decision").length).toBe(3);
  expect(lines.filter((l) => l.kind === "outcome").length).toBe(3);
  expect(led.cycles("BTC", day).every((c) => c.outcome?.high_conf_miss === false)).toBe(true);
  expect(led.read("BTC", "20260924").length).toBe(0);
});

test("ciclo novo fica pendente; ciclo sem marca fica para a proxima", async () => {
  const led = new Ledger(`${DIR}/pendente`);
  const novo = T0 + 500_000;
  led.writeDecision(decision(novo, "buy", 0.9));
  const cedo = await runOutcomes({ ledger: led, marks: marks(100, 101), now: novo + 1000, horizonSecs: HORIZON });
  expect(cedo).toMatchObject({ written: 0, pending: 1 });

  const semVela = await runOutcomes({ ledger: led, marks: marks(null, null), now: novo + HORIZON * 1000, horizonSecs: HORIZON });
  expect(semVela).toMatchObject({ written: 0, pending: 0, skipped: 1 });
  expect(led.all()[0]!.outcome).toBe(null);

  const tarde = await runOutcomes({ ledger: led, marks: marks(100, 98), now: novo + HORIZON * 1000, horizonSecs: HORIZON, confAct: CONF_ACT });
  expect(tarde.written).toBe(1);
  expect(led.all()[0]!.outcome?.high_conf_miss).toBe(true);
});

test("nenhuma linha do outcome carrega chave", async () => {
  const led = new Ledger(`${DIR}/segredo`);
  const ts = T0 + 900_000;
  led.writeDecision(decision(ts, "buy", 0.9));
  await runOutcomes({ ledger: led, marks: marks(100, 101), now: ts + HORIZON * 1000, horizonSecs: HORIZON });
  const all = led.all().map((c) => JSON.stringify(c)).join("\n");
  expect(all).not.toMatch(/privateKey|apiKey|0x[a-fA-F0-9]{40,}/);
});

test("closeAt pega a ultima vela que cobre o instante", () => {
  const candles = [
    { t: T0 - CANDLE_MS, c: "99.0" },
    { t: T0, c: "100.0" },
    { t: T0 + CANDLE_MS, c: "101.0" },
  ];
  expect(closeAt(candles, T0)).toBe(100);
  expect(closeAt(candles, T0 + 30_000)).toBe(100);
  expect(closeAt(candles, T0 + CANDLE_MS + 1)).toBe(101);
  expect(closeAt(candles, T0 - CANDLE_MS * 2)).toBe(null);
  expect(closeAt([{ t: T0, c: "0" }], T0)).toBe(null);
});

test("sumFunding soma so o que cai no intervalo aberto a esquerda", () => {
  const rows = [
    { fundingRate: "0.00001", time: T0 },
    { fundingRate: "0.00002", time: T0 + 1000 },
    { fundingRate: "0.00004", time: T0 + 2000 },
  ];
  expect(sumFunding(rows, T0, T0 + 1000)).toBeCloseTo(0.00002, 10);
  expect(sumFunding(rows, T0, T0 + 2000)).toBeCloseTo(0.00006, 10);
  expect(sumFunding(rows, T0 + 2000, T0 + 3000)).toBe(0);
});
