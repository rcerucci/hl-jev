import { afterAll, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { emptyRegime, loadRegime, saveRegime } from "../src/regime";
import { SigmaPolicy } from "../src/policy/sigma";
import type { SigmaBar } from "../src/risk/types";

const DIR = "./data/test-regime";
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const H = 3_600_000;
const T0 = Date.UTC(2026, 8, 25, 0, 0, 0);
const plana = (n: number, px = 100) =>
  Array.from({ length: n }, () => ({ high: px + 1, low: px - 1, close: px }));
const serie = (rows: { high: number; low: number; close: number }[]): SigmaBar[] =>
  rows.map((r, i) => ({ t: T0 + i * H, high: r.high, low: r.low, close: r.close }));
const cid = (ms: number) =>
  `${new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}-BTC`;

test("save/load: s, prevRaw e CB sobrevivem ao processo", () => {
  const path = saveRegime(DIR, "BTC", {
    s: -1,
    prevRaw: "sell",
    cb: { flips: [T0, T0 + H], until: T0 + 6 * H, lastClosedAt: T0 + H },
  });
  expect(path.endsWith("BTC.json")).toBe(true);
  const got = loadRegime(DIR, "btc");
  expect(got).toEqual({
    s: -1,
    prevRaw: "sell",
    cb: { flips: [T0, T0 + H], until: T0 + 6 * H, lastClosedAt: T0 + H },
  });
});

test("json partido ou incompleto nao inventa regime", () => {
  expect(loadRegime(DIR, "NOEXISTE")).toBeNull();
  saveRegime(DIR, "BAD", emptyRegime());
  const { writeFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  writeFileSync(join(DIR, "BAD.json"), "{nao json", "utf8");
  expect(loadRegime(DIR, "BAD")).toBeNull();
});

test("SigmaPolicy com dir: a segunda instancia herda s e prevRaw", async () => {
  const bars = serie([...plana(30), { high: 106, low: 96, close: 104 }]);
  const ctx = { returns_bps: { last1: 0, last5: 0, last20: 0 }, h1: bars };
  const a = new SigmaPolicy(DIR);
  const primeiro = await a.decide("s", cid(T0 + 30 * H + H), ctx);
  expect(primeiro.raw).toBe("buy");

  const b = new SigmaPolicy(DIR);
  const segundo = await b.decide("s", cid(T0 + 30 * H + H + 240_000), ctx);
  expect(segundo.raw).toBe("buy");
  expect(segundo.signal).toBe("hold");
});

test("sem dir a policy nao grava (os testes do sigma ficam isolados)", async () => {
  const p = new SigmaPolicy();
  await p.decide("s", cid(T0), { returns_bps: { last1: 0, last5: 0, last20: 0 } });
  expect(loadRegime(DIR, "ORFA")).toBeNull();
});

test("CB activo no disco: a instancia nova nasce em caixa", async () => {
  const closedAt = T0 + 30 * H + H;
  saveRegime(DIR, "SOL", {
    s: 1,
    prevRaw: "buy",
    cb: {
      flips: [closedAt - 3 * H, closedAt - 2 * H, closedAt - H, closedAt],
      until: closedAt + 6 * H,
      lastClosedAt: closedAt,
    },
  });
  const bars = serie([...plana(30), { high: 106, low: 96, close: 104 }]);
  const p = new SigmaPolicy(DIR);
  const v = await p.decide(
    "s",
    `${new Date(closedAt).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}-SOL`,
    { returns_bps: { last1: 0, last5: 0, last20: 0 }, h1: bars },
  );
  expect(v.cb_active).toBe(true);
  expect(v.raw).toBe("caixa");
});
