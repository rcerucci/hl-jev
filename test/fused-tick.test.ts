import { afterAll, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { Ledger } from "../src/ledger/jsonl";
import type { Market } from "../src/market";
import { MockModel, type Model } from "../src/model";
import { DumbPolicy } from "../src/policy/dumb";
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
  const { events } = await tick(new ScriptPolicy(verdict({ act: "sell", act: "sell", act_conf: 0.81, too_hostile: 0.22 })));
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
