import { describe, expect, test } from "bun:test";
import { StancePolicy, STANCE, rawStance, signalFrom } from "../src/policy/stance";
import { emaSmaSeed, rangeU, stanceFeatures, type StanceBar } from "../src/policy/stance_features";
import { planFromRisk } from "../src/plan";
import { isFrozen, riskIntent, standsDown } from "../src/risk/intent";
import { toSnapshot, type SnapshotInput } from "../src/risk/buckets";
import type { Verdict } from "../src/risk/types";

test("u no tecto com s>0 e caixa; abaixo do tecto e buy", () => {
  expect(rawStance(1, 0.85)).toBe("caixa");
  expect(rawStance(1, 0.849)).toBe("buy");
  expect(rawStance(-1, 0.15)).toBe("caixa");
  expect(rawStance(-1, 0.151)).toBe("sell");
  expect(rawStance(0, 0.5)).toBe("caixa");
});

test("signal hold so quando raw nao mudou", () => {
  expect(signalFrom("buy", undefined)).toBe("buy");
  expect(signalFrom("buy", "buy")).toBe("hold");
  expect(signalFrom("caixa", "buy")).toBe("caixa");
  expect(signalFrom("caixa", "caixa")).toBe("hold");
});

test("sem features a policy nao inventa lado: caixa", async () => {
  const p = new StancePolicy();
  const v = await p.decide("tight deep quiet flat flat pay_neutral mid", "20260925T000000Z-BTC");
  expect(v.raw).toBe("caixa");
  expect(v.signal).toBe("caixa");
  expect(v.act).toBe("hold");
  expect(v.model).toBe("stance");
});

test("vector dourado: s=+1 u=0.832 → buy, segundo tick hold", async () => {
  const p = new StancePolicy();
  const cid = "20260925T080000Z-BTC";
  const ctx = { returns_bps: { last1: 0, last5: 0, last20: 0 }, s: 1, u: 0.832 };
  const a = await p.decide("state", cid, ctx);
  expect(a.raw).toBe("buy");
  expect(a.signal).toBe("buy");
  expect(a.act).toBe("buy");
  const b = await p.decide("state", cid, { ...ctx, raw_prev: "buy" });
  expect(b.signal).toBe("hold");
  expect(b.raw).toBe("buy");
  expect(b.act).toBe("hold");
});

test("os 4 rotulos no mesmo sleeve: buy, hold, caixa, sell", async () => {
  const p = new StancePolicy();
  const cid = "20260925T081500Z-BTC";
  const ctx = { returns_bps: { last1: 0, last5: 0, last20: 0 } };
  const buy = await p.decide("s", cid, { ...ctx, s: 1, u: 0.5 });
  expect(buy.raw).toBe("buy");
  expect(buy.signal).toBe("buy");
  const hold = await p.decide("s", cid, { ...ctx, s: 1, u: 0.5, raw_prev: "buy" });
  expect(hold.raw).toBe("buy");
  expect(hold.signal).toBe("hold");
  const caixa = await p.decide("s", cid, { ...ctx, s: 1, u: 0.9, raw_prev: "buy" });
  expect(caixa.raw).toBe("caixa");
  expect(caixa.signal).toBe("caixa");
  const sell = await p.decide("s", cid, { ...ctx, s: -1, u: 0.5, raw_prev: "caixa" });
  expect(sell.raw).toBe("sell");
  expect(sell.signal).toBe("sell");
});

test("constantes pinadas", () => {
  expect(STANCE.L).toBe(130);
  expect(STANCE.CHAO).toBe(0.15);
  expect(STANCE.TECTO).toBe(0.85);
});

function snap(over: Partial<SnapshotInput> = {}) {
  return toSnapshot({
    ts: Date.UTC(2026, 8, 25, 12, 0, 0),
    sleeve: "BTC",
    book: { bid: 100, ask: 100.1, mid: 100.05, spreadBps: 10, depthBps: { "10": { bid: 1, ask: 1 } } },
    bookAgeMs: 10,
    returnsBps: { last1: 0, last5: 0, last20: 0 },
    volBps: 1,
    prints: { count: 10, buySz: 1, sellSz: 1, cvdSz: 0 },
    position: { side: "flat", size: 0 },
    account: { equityUsd: 200, unrealizedUsd: 0, leverage: 1 },
    fundingBps: 0,
    mark: 100,
    bankrollUsd: 200,
    maxLeverage: 40,
    ...over,
  });
}

function v(over: Partial<Verdict> = {}): Verdict {
  return {
    cycle_id: "20260925T120000Z-BTC",
    model: "stance",
    latency_ms: 0,
    act: "hold",
    act_probs: { buy: 0.05, sell: 0.05, hold: 0.9 },
    act_conf: 0.9,
    too_hostile: 0.1,
    raw_ok: true,
    raw: "caixa",
    signal: "caixa",
    ...over,
  };
}

test("caixa no risco: hold + reason caixa + stand-down se flat", () => {
  const i = riskIntent({ cycleId: "c", sleeve: "BTC", verdict: v(), snap: snap() });
  expect(i.side).toBe("hold");
  expect(i.reason).toBe("caixa");
  expect(isFrozen(i)).toBe(false);
  expect(standsDown(i)).toBe(true);
  expect(planFromRisk(i, 0, 0.01)).toBeNull();
});

test("caixa com posicao long: IOC reduce-only sell", () => {
  const i = riskIntent({
    cycleId: "c",
    sleeve: "BTC",
    verdict: v(),
    snap: snap({ position: { side: "long", size: 0.4 } }),
  });
  expect(i.reason).toBe("caixa");
  const plan = planFromRisk(i, 0.4, 0.01);
  expect(plan).toMatchObject({ side: "sell", size: 0.4, reduceOnly: true, taker: true });
});

test("hold de postura nao desmonta a resting", () => {
  const i = riskIntent({
    cycleId: "c",
    sleeve: "BTC",
    verdict: v({ act: "hold", raw: "buy", signal: "hold" }),
    snap: snap(),
  });
  expect(i.reason).toBe("stance_hold");
  expect(standsDown(i)).toBe(false);
  expect(planFromRisk(i, 0, 0.01)).toBeNull();
});

describe("features: sem lookahead na H1", () => {
  test("rangeU precisa de L barras", () => {
    const bars: StanceBar[] = [];
    for (let i = 0; i < 10; i++) bars.push({ t: i * 300_000, high: 2, low: 1, mid: 1.5 });
    expect(rangeU(bars, bars[9]!, 130)).toBeNull();
  });

  test("EMA seed SMA 24", () => {
    const xs = Array.from({ length: 24 }, () => 10);
    const e = emaSmaSeed(xs);
    expect(e[23]).toBe(10);
    expect(e[22]).toBeNull();
  });

  test("stanceFeatures devolve null sem historico", () => {
    expect(stanceFeatures([], [], Date.now())).toBeNull();
  });
});
