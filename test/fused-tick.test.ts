import { afterAll, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { Ledger } from "../src/ledger/jsonl";
import type { Market } from "../src/market";
import { MockModel, type Model } from "../src/model";
import { DumbPolicy } from "../src/policy/dumb";
import { SigmaPolicy } from "../src/policy/sigma";
import { StancePolicy } from "../src/policy/stance";
import type { Policy, Verdict } from "../src/risk/types";
import { Trader } from "../src/trader";
import type { BlockEvent, Book, Quote, Side } from "../src/types";

const DIR = "./data/test-fused";
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const book: Book = {
  block: 1,
  bid: 99.9,
  ask: 100.1,
  mid: 100,
  spreadBps: 20,
  imbalance: 0,
  levels: { bids: [[99.9, 1]], asks: [[100.1, 1]] },
  depthBps: { "10": { bid: 1, ask: 1 } },
};

class FakeMarket {
  readonly coin = "BTC";
  readonly pair = "BTC-USD";
  readonly label = "BTC";
  readonly wallet = null;
  readonly account = null;
  readonly szDecimals = 5;
  readonly maxLeverage = 40;
  readonly fillPrints: [] = [];
  assetCtx = null;
  bookAt: number | null = Date.now();
  sends: { side: Side; size: number; reduceOnly: boolean; taker: boolean }[] = [];
  cancels = 0;
  leverages: number[] = [];
  candleCloses() { return []; }
  candleBars5m(): { ts: number; high: number; low: number; close?: number }[] { return []; }
  candleBars1h(): { ts: number; high: number; low: number; close?: number }[] { return []; }
  refresh() { return Promise.resolve(); }
  readBook() { return book; }
  quoteSize() { return 0.01; }
  setLeverage(n: number) { this.leverages.push(n); return Promise.resolve(n); }
  async send(side: Side, size: number, _b: Book, _c: number[], reduceOnly = false, taker = false): Promise<Quote> {
    this.sends.push({ side, size, reduceOnly, taker });
    return { side, price: 99.9, size, txHash: null, cancel: [], status: "placed", orderId: 1, capped: false, reduceOnly, taker };
  }
  async cancelResting() { this.cancels++; return []; }
}

class ScriptPolicy implements Policy {
  readonly name = "script";
  constructor(private v: Verdict) {}
  async decide(): Promise<Verdict> { return this.v; }
}

function verdict(over: Partial<Verdict> = {}): Verdict {
  return {
    cycle_id: "20260923T123015Z-BTC",
    model: "jev-1.13.0",
    latency_ms: 12,
    act: "buy",
    act_probs: { buy: 0.7, sell: 0.1, hold: 0.2 },
    act_conf: 0.9,
    too_hostile: 0.1,
    raw_ok: true,
    ...over,
  };
}

/** Um tick pelo caminho da fusao, com a fila do venue ja drenada. */
let seq = 0;
async function tick(policy: Policy) {
  const market = new FakeMarket();
  const events: BlockEvent[] = [];
  // Cada teste tem o seu diretorio: o ledger e append-only e nao se limpa sozinho.
  const ledger = new Ledger(`${DIR}/${++seq}`);
  const trader = new Trader(
    market as unknown as Market,
    new MockModel() as unknown as Model,
    (e) => events.push(e),
    () => {},
    () => {},
    { policy, ledger },
  );
  await trader.onBlock(1);
  await Bun.sleep(60);
  return { market, events, ledger };
}

const today = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
};

test("buy entra como ALO post-only e a alavancagem vem do config, nao do Jev", async () => {
  const { market } = await tick(new ScriptPolicy(verdict({ act: "buy" })));
  expect(market.sends.length).toBe(1);
  expect(market.sends[0]).toMatchObject({ side: "buy", reduceOnly: false, taker: false });
  expect(market.leverages.length).toBe(1);
});

test("hold explicito do Jev: nenhuma ordem e a resting e desmontada", async () => {
  const { market, events } = await tick(new ScriptPolicy(verdict({ act: "hold", act_conf: 0.5 })));
  expect(market.sends.length).toBe(0);
  expect(market.cancels).toBeGreaterThan(0);
  const last = events.at(-1)!;
  expect(last.decision?.late).toBe(false);
  expect(last.decision?.act).toBe("hold");
});

test("sem resposta valida congela o livro: nem ordem nova, nem cancelamento", async () => {
  const { market, events } = await tick(new ScriptPolicy(verdict({ raw_ok: false, note: "timeout" })));
  expect(market.sends.length).toBe(0);
  expect(market.cancels).toBe(0);
  // O bloco continua a sair, marcado late, com o que a POLICY respondeu.
  const last = events.at(-1)!;
  expect(last.decision?.late).toBe(true);
  expect(last.decision?.state12).toBeTruthy();
});

test("o tick escreve a linha de decision no ledger, sem digitos e sem chave", async () => {
  const { ledger } = await tick(new ScriptPolicy(verdict({ act: "buy" })));
  const lines = ledger.read("BTC", today());
  expect(lines.length).toBe(1);
  const line = lines[0]!;
  expect(line.kind).toBe("decision");
  expect((line as { state: string }).state).not.toMatch(/\d/);
  expect(JSON.stringify(line)).not.toMatch(/privateKey|0x[a-fA-F0-9]{40,}/);
});

test("o desk recebe o state curto e as colunas novas", async () => {
  const { events } = await tick(new ScriptPolicy(verdict({ act: "sell", act_conf: 0.81, too_hostile: 0.22 })));
  const d = events.at(-1)!.decision!;
  expect(d.state12!.split(" ").length).toBeLessThanOrEqual(12);
  expect(d.act).toBe("sell");
  expect(d.act_conf).toBe(0.81);
  expect(d.too_hostile).toBe(0.22);
});

test("o controle dumb decide com as mesmas palavras, sem rede", async () => {
  const dumb = new DumbPolicy();
  expect((await dumb.decide("normal ok quiet pumping flat pay_neutral mid", "20260923T123015Z-BTC")).act).toBe("buy");
  expect((await dumb.decide("normal ok quiet dumping flat pay_neutral mid", "20260923T123015Z-BTC")).act).toBe("sell");
  expect((await dumb.decide("normal ok quiet flat flat pay_neutral mid", "20260923T123015Z-BTC")).act).toBe("hold");
});

test("o tick fundido nao toca no modelo legado", async () => {
  const { market, events } = await tick(new ScriptPolicy(verdict({ act: "buy" })));
  // O caminho legado publicaria intent/bias; o da fusao publica act.
  const d = events.at(-1)!.decision!;
  expect(d.act).toBe("buy");
  expect(market.sends[0]!.taker).toBe(false);
});

test("stance sem velas 5m fica em caixa: sem ordem nova, cancela resting", async () => {
  const { market, ledger } = await tick(new StancePolicy());
  expect(market.sends.length).toBe(0);
  expect(market.cancels).toBeGreaterThan(0);
  const line = ledger.read("BTC", today())[0] as { raw?: string; signal?: string };
  expect(line.raw).toBe("caixa");
  expect(line.signal).toBe("caixa");
});

test("stance com canal no meio e s>0 entra buy ALO; o tick seguinte e hold sem cancelar", async () => {
  const now = Date.now();
  const step5 = 300_000;
  const step1h = 3_600_000;
  const last5 = Math.floor(now / step5) * step5 - step5;
  const bars5 = Array.from({ length: 130 }, (_, i) => {
    const ts = last5 - (129 - i) * step5;
    return { ts, high: 110, low: 90, close: 100 };
  });
  const last1h = Math.floor(now / step1h) * step1h - 2 * step1h;
  const bars1h = Array.from({ length: 30 }, (_, i) => {
    const ts = last1h - (29 - i) * step1h;
    return { ts, high: 96, low: 94, close: 95 };
  });
  const market = new FakeMarket();
  market.candleBars5m = () => bars5;
  market.candleBars1h = () => bars1h;
  const ledger = new Ledger(`${DIR}/${++seq}`);
  const trader = new Trader(
    market as unknown as Market,
    new MockModel() as unknown as Model,
    () => {},
    () => {},
    () => {},
    { policy: new StancePolicy(), ledger },
  );
  await trader.onBlock(1);
  await Bun.sleep(60);
  expect(market.sends.length).toBe(1);
  expect(market.sends[0]).toMatchObject({ side: "buy", reduceOnly: false, taker: false });
  const first = ledger.read("BTC", today())[0] as { raw?: string; signal?: string };
  expect(first.raw).toBe("buy");
  expect(first.signal).toBe("buy");
  market.sends = [];
  const cancelsBefore = market.cancels;
  await trader.onBlock(2);
  await Bun.sleep(60);
  expect(market.sends.length).toBe(0);
  expect(market.cancels).toBe(cancelsBefore);
  const second = ledger.read("BTC", today())[1] as { raw?: string; signal?: string };
  expect(second.raw).toBe("buy");
  expect(second.signal).toBe("hold");
});

/**
 * F4 — barras H1 do sigma: 29 velas em hl2=95 (EMA = 95) e a ultima fechada a decidir o lado.
 * `newer = 1` empurra a serie uma hora para a frente, ou seja nasce uma H1 fechada nova.
 */
function sigmaBars1h(now: number, newer = 0, lado: "up" | "down" = "up") {
  const step1h = 3_600_000;
  const last1h = Math.floor(now / step1h) * step1h - (2 - newer) * step1h;
  return Array.from({ length: 30 }, (_, i) => {
    const ts = last1h - (29 - i) * step1h;
    if (i !== 29) return { ts, high: 96, low: 94, close: 95 };
    return lado === "up"
      ? { ts, high: 110, low: 100, close: 108 } // hl2 105 > 95, close confirma
      : { ts, high: 90, low: 80, close: 82 }; // hl2 85 < 95, close confirma
  });
}

/** Doze velas de 5m dentro da mesma H1: o sigma nao as le, mas o tick corre nelas. */
function sigmaBars5m(now: number) {
  const step5 = 300_000;
  const last5 = Math.floor(now / step5) * step5 - step5;
  return Array.from({ length: 12 }, (_, i) => ({ ts: last5 - (11 - i) * step5, high: 110, low: 90, close: 100 }));
}

function sigmaTrader(market: FakeMarket, ledger: Ledger) {
  return new Trader(
    market as unknown as Market,
    new MockModel() as unknown as Model,
    () => {},
    () => {},
    () => {},
    { policy: new SigmaPolicy(), ledger },
  );
}

test("sigma F4: a primeira H1 fechada nova decide como hoje (s -> buy)", async () => {
  const now = Date.now();
  const market = new FakeMarket();
  market.candleBars1h = () => sigmaBars1h(now);
  market.candleBars5m = () => sigmaBars5m(now);
  const ledger = new Ledger(`${DIR}/${++seq}`);
  await sigmaTrader(market, ledger).onBlock(1);
  await Bun.sleep(60);
  expect(market.sends.length).toBe(1);
  expect(market.sends[0]).toMatchObject({ side: "buy", reduceOnly: false, taker: false });
  const line = ledger.read("BTC", today())[0] as { raw?: string; signal?: string; wick_veto?: boolean };
  expect(line.raw).toBe("buy");
  expect(line.signal).toBe("buy");
  expect(line.wick_veto).toBe(false);
});

test("sigma F4: doze blocos na mesma H1 -> zero planos de lado, signal hold, resting intacta", async () => {
  const now = Date.now();
  const market = new FakeMarket();
  market.candleBars1h = () => sigmaBars1h(now);
  market.candleBars5m = () => sigmaBars5m(now);
  const ledger = new Ledger(`${DIR}/${++seq}`);
  const trader = sigmaTrader(market, ledger);
  await trader.onBlock(1);
  await Bun.sleep(60);
  expect(market.sends.length).toBe(1); // a H1 fechada nova decidiu

  market.sends = [];
  const cancelsBefore = market.cancels;
  for (let b = 2; b <= 13; b++) {
    await trader.onBlock(b);
    await Bun.sleep(5);
  }
  expect(market.sends.length).toBe(0); // nenhum plano de lado em 12 blocos
  expect(market.cancels).toBe(cancelsBefore); // e a resting que serve nao foi desmontada

  const linhas = ledger.read("BTC", today()) as { raw?: string; signal?: string }[];
  expect(linhas.length).toBe(13); // 1 decisao + 12 do portao
  for (const l of linhas.slice(1)) {
    expect(l.signal).toBe("hold");
    expect(l.raw).toBe("buy"); // a postura nao muda no portao
  }
});

test("sigma F4: uma H1 fechada nova reabre a decisao e a virada e' executada", async () => {
  const now = Date.now();
  let newer = 0;
  let lado: "up" | "down" = "up";
  const market = new FakeMarket();
  market.candleBars1h = () => sigmaBars1h(now, newer, lado);
  market.candleBars5m = () => sigmaBars5m(now);
  const ledger = new Ledger(`${DIR}/${++seq}`);
  const trader = sigmaTrader(market, ledger);
  await trader.onBlock(1);
  await Bun.sleep(60);
  expect(market.sends.length).toBe(1);
  expect(market.sends[0]).toMatchObject({ side: "buy" }); // s = +1

  market.sends = [];
  await trader.onBlock(2);
  await Bun.sleep(60);
  expect(market.sends.length).toBe(0); // mesma H1: o portao segura

  // Nasce a H1 seguinte E o `s` vira: e' a virada que a decisao tem de executar.
  newer = 1;
  lado = "down";
  await trader.onBlock(3);
  await Bun.sleep(60);
  expect(market.sends.length).toBe(1);
  expect(market.sends[0]).toMatchObject({ side: "sell", reduceOnly: false, taker: false });
  const linhas = ledger.read("BTC", today()) as { raw?: string; signal?: string }[];
  expect(linhas[1]!.signal).toBe("hold"); // o bloco da mesma H1
  expect(linhas[2]!.signal).toBe("sell"); // a H1 nova com o s virado
});
