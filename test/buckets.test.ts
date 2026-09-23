import { expect, test } from "bun:test";
import {
  DEPTH_USD,
  FLOW,
  INVENTORY,
  SPREAD,
  TAPE,
  clockBucket,
  stanceFromState,
  toSnapshot,
  toState,
  type SnapshotInput,
} from "../src/risk/buckets";

/** Snapshot ficticio: livro fundo, fita calma, sem posicao. */
function input(over: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    ts: Date.UTC(2026, 8, 23, 12, 30, 15),
    sleeve: "SOL",
    book: {
      bid: 187.2,
      ask: 187.28,
      mid: 187.24,
      spreadBps: 4.3,
      depthBps: { "10": { bid: 120.4, ask: 38.1 } },
    },
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
}

const state = (over: Partial<SnapshotInput> = {}) => toState(toSnapshot(input(over)));

test("state nao leva um unico digito e cabe em STATE_MAX_WORDS", () => {
  const s = state();
  expect(s).not.toMatch(/\d/);
  expect(s.split(" ").length).toBeLessThanOrEqual(12);
  expect(s).toBe("normal deep two_way flat flat pay_neutral mid");
});

test("state e deterministico: mesmo snapshot, mesma linha", () => {
  expect(state()).toBe(state());
  expect(toState(toSnapshot(input()))).toBe(state());
});

test("buckets de spread", () => {
  expect(state({ book: { ...input().book, spreadBps: 1 } })).toStartWith("tight ");
  expect(state({ book: { ...input().book, spreadBps: SPREAD.NORMAL_BPS + 1 } })).toStartWith("wide ");
  expect(state({ book: { ...input().book, spreadBps: SPREAD.WIDE_BPS + 1 } })).toStartWith("unfillable ");
  expect(state({ book: { ...input().book, spreadBps: 0 } })).toStartWith("unfillable ");
});

test("buckets de profundidade em USD dentro de dez bps", () => {
  const thin = { "10": { bid: 1, ask: 1 } };
  const empty = { "10": { bid: 0, ask: 0 } };
  expect(state({ book: { ...input().book, depthBps: thin } }).split(" ")[1]).toBe("thin");
  expect(state({ book: { ...input().book, depthBps: empty } }).split(" ")[1]).toBe("empty");
  // O livro do snapshot ficticio tem (120.4 + 38.1) * 187.24 USD, acima do limiar de "deep".
  expect(toSnapshot(input()).depth_usd_10bps).toBeGreaterThan(DEPTH_USD.DEEP);
  expect(state().split(" ")[1]).toBe("deep");
});

test("buckets de fluxo: quiet, bot_war, lift, dump, two_way", () => {
  const flow = (count: number, cvd: number) =>
    state({ prints: { count, buySz: 50, sellSz: 50, cvdSz: cvd } }).split(" ")[2];
  expect(flow(FLOW.QUIET_PRINTS - 1, 0)).toBe("quiet");
  expect(flow(FLOW.BOT_WAR_PRINTS, 30)).toBe("bot_war");
  expect(flow(20, 40)).toBe("lift");
  expect(flow(20, -40)).toBe("dump");
  expect(flow(20, 0)).toBe("two_way");
});

test("buckets de fita: flat, grinding, pumping, dumping, violent", () => {
  const tape = (last5: number, vol: number | null = 0) =>
    state({ returnsBps: { last1: 0, last5, last20: last5 }, volBps: vol }).split(" ")[3];
  expect(tape(TAPE.GRIND_BPS - 1)).toBe("flat");
  expect(tape(TAPE.GRIND_BPS + 1)).toBe("grinding");
  expect(tape(TAPE.MOVE_BPS + 1)).toBe("pumping");
  expect(tape(-(TAPE.MOVE_BPS + 1))).toBe("dumping");
  expect(tape(TAPE.VIOLENT_BPS + 1)).toBe("violent");
  expect(tape(0, TAPE.VIOLENT_BPS)).toBe("violent");
});

test("buckets de inventario contra o capital de referencia", () => {
  const inv = (side: "long" | "short" | "flat", size: number, equity = 200) =>
    state({ position: { side, size }, account: { equityUsd: equity, unrealizedUsd: 0, leverage: 1 } }).split(" ")[4];
  expect(inv("flat", 0)).toBe("flat");
  expect(inv("long", 0.5)).toBe("long_small");
  expect(inv("long", 1.5)).toBe("long_heavy");
  expect(inv("short", -0.5)).toBe("short_small");
  expect(inv("short", -1.5)).toBe("short_heavy");
});

test("inventario pesado depende da referencia: mesma posicao, equity diferente", () => {
  const size = 0.5;
  expect(state({ position: { side: "long", size } }).split(" ")[4]).toBe("long_small");
  // A mesma posicao com dez vezes o capital deixa de ser inventario relevante.
  const rico = state({ position: { side: "long", size }, account: { equityUsd: 20_000, unrealizedUsd: 0, leverage: 1 } });
  expect(rico.split(" ")[4]).toBe("flat");
  expect(INVENTORY.HEAVY_RATIO).toBe(0.5);
});

test("buckets de funding: neutro, pago por cada lado, extremo", () => {
  const fund = (bps: number | null) => state({ fundingBps: bps }).split(" ")[5];
  expect(fund(0.01)).toBe("pay_neutral");
  expect(fund(null)).toBe("pay_neutral");
  expect(fund(0.5)).toBe("pay_long");
  expect(fund(-0.5)).toBe("pay_short");
  expect(fund(2)).toBe("extreme");
});

test("clock usa UTC: janela de funding, abertura e horas mortas", () => {
  expect(clockBucket(Date.UTC(2026, 8, 23, 12, 58))).toBe("funding_window");
  expect(clockBucket(Date.UTC(2026, 8, 23, 12, 2))).toBe("open_liq");
  expect(clockBucket(Date.UTC(2026, 8, 23, 3, 30))).toBe("dead");
  expect(clockBucket(Date.UTC(2026, 8, 23, 12, 30))).toBe("mid");
});

test("a estance vem do proprio state, sem numeros", () => {
  expect(stanceFromState("thin bot_war pumping long_heavy pay_long tight")).toBe("long");
  expect(stanceFromState("thin bot_war pumping short_small pay_long tight")).toBe("short");
  expect(stanceFromState("thin bot_war pumping flat pay_long tight")).toBe("flat");
});
