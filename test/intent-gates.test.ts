import { expect, test } from "bun:test";
import { isFrozen, reducingExisting, riskIntent, standsDown, wouldIncreaseRisk } from "../src/risk/intent";
import { toSnapshot, type SnapshotInput } from "../src/risk/buckets";
import type { Verdict } from "../src/risk/types";

const TH = { confAct: 0.8, hostileTh: 0.65, staleMs: 5000 };

function snap(over: Partial<SnapshotInput> = {}) {
  const base: SnapshotInput = {
    ts: Date.UTC(2026, 8, 23, 12, 30, 15),
    sleeve: "SOL",
    book: { bid: 187.2, ask: 187.28, mid: 187.24, spreadBps: 4.3, depthBps: { "10": { bid: 120.4, ask: 38.1 } } },
    bookAgeMs: 42,
    returnsBps: { last1: 2, last5: 3, last20: 1 },
    volBps: 6,
    prints: { count: 20, buySz: 60, sellSz: 55, cvdSz: 5 },
    position: { side: "flat", size: 0 },
    account: { equityUsd: 200, unrealizedUsd: 0, leverage: 1 },
    fundingBps: 0.02,
    mark: 187.21,
    bankrollUsd: 200,
    maxLeverage: 40,
    ...over,
  };
  return toSnapshot(base);
}

function verdict(over: Partial<Verdict> = {}): Verdict {
  return {
    cycle_id: "20260923T123015Z-SOL",
    model: "jev-1.13.0",
    latency_ms: 214,
    act: "buy",
    act_probs: { buy: 0.7, sell: 0.1, hold: 0.2 },
    act_conf: 0.86,
    too_hostile: 0.1,
    raw_ok: true,
    ...over,
  };
}

const gate = (over: Partial<Verdict> = {}, position: Partial<SnapshotInput> = {}) =>
  riskIntent({ cycleId: "20260923T123015Z-SOL", sleeve: "SOL", verdict: verdict(over), snap: snap(position), ...TH });

test("timeout congela: hold, sem ordem nova e sem cancelar", () => {
  const i = gate({ raw_ok: false, note: "timeout" });
  expect(i.side).toBe("hold");
  expect(i.reason).toBe("frozen_timeout");
  expect(isFrozen(i)).toBe(true);
  expect(standsDown(i)).toBe(false);
  expect(i.urgency).toBe("none");
});

test("JSON invalido congela com a mesma consequencia do timeout", () => {
  const i = gate({ raw_ok: false, note: "parse" });
  expect(i.reason).toBe("frozen_raw");
  expect(isFrozen(i)).toBe(true);
});

test("livro velho congela", () => {
  const i = gate({}, { bookAgeMs: TH.staleMs + 1 });
  expect(i.reason).toBe("frozen_stale");
  expect(isFrozen(i)).toBe(true);
});

test("confianca abaixo do limiar: hold explicito, logo stand-down", () => {
  const i = gate({ act_conf: 0.79 });
  expect(i.side).toBe("hold");
  expect(i.reason).toBe("low_conf");
  expect(isFrozen(i)).toBe(false);
  expect(standsDown(i)).toBe(true);
});

test("noul hostil com livro plano: hold explicito", () => {
  const i = gate({ too_hostile: 0.9 });
  expect(i.side).toBe("hold");
  expect(i.reason).toBe("hostile");
  expect(standsDown(i)).toBe(true);
});

test("noul hostil nao trava uma ordem que reduz o que esta aberto", () => {
  const i = gate({ too_hostile: 0.9, act: "sell" }, { position: { side: "long", size: 0.5 } });
  expect(i.side).toBe("sell");
  expect(i.reduce_only).toBe(true);
  expect(i.reason).toBe("jev_act");
});

test("hold do proprio Jev e stand-down, nao congelamento", () => {
  const i = gate({ act: "hold" });
  expect(i.reason).toBe("jev_hold");
  expect(isFrozen(i)).toBe(false);
  expect(standsDown(i)).toBe(true);
});

test("v1 nunca adiciona a inventario pesado", () => {
  const i = gate({ act: "buy" }, { position: { side: "long", size: 1.5 } });
  expect(i.side).toBe("hold");
  expect(i.reason).toBe("inventory_block");
  expect(standsDown(i)).toBe(true);
});

test("entrada limpa sai maker, sem reduce-only", () => {
  const i = gate();
  expect(i).toMatchObject({ side: "buy", urgency: "maker", reduce_only: false, reason: "jev_act", conf: 0.86 });
});

test("vender contra uma posicao comprada marca reduce_only", () => {
  const i = gate({ act: "sell" }, { position: { side: "long", size: 0.5 } });
  expect(i.reduce_only).toBe(true);
  expect(reducingExisting("long", "sell")).toBe(true);
  expect(reducingExisting("short", "sell")).toBe(false);
});

test("o gate de risco por inventario so olha para o lado que adiciona", () => {
  expect(wouldIncreaseRisk({ pos_side: "long" }, "buy", "long_heavy")).toBe(true);
  expect(wouldIncreaseRisk({ pos_side: "long" }, "buy", "long_small")).toBe(false);
  expect(wouldIncreaseRisk({ pos_side: "short" }, "sell", "short_heavy")).toBe(true);
  expect(wouldIncreaseRisk({ pos_side: "long" }, "sell", "long_heavy")).toBe(false);
});
