import { afterAll, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { config } from "../src/config";
import { Ledger } from "../src/ledger/jsonl";
import type { Market } from "../src/market";
import { MockModel, type Model } from "../src/model";
import { DumbPolicy } from "../src/policy/dumb";
import { quotePrice } from "../src/book";
import { SIGMA_FILL, SigmaPolicy } from "../src/policy/sigma";
import { TradeFeed } from "../src/trades";
import { StancePolicy } from "../src/policy/stance";
import type { Policy, Verdict } from "../src/risk/types";
import { Trader } from "../src/trader";
import type { BlockEvent, Book, Quote, Side } from "../src/types";

const DIR = "./data/test-fused";
const POLICY_NO_DISCO = (config as { policy: string }).policy;
const DISCO_NO_SALDO = (config as { bankrollUsd: number }).bankrollUsd;
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
afterAll(() => {
  (config as { policy: string }).policy = POLICY_NO_DISCO;
  (config as { bankrollUsd: number }).bankrollUsd = DISCO_NO_SALDO;
});

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
  /** O saldo da sleeve: o F6 dimensiona por aqui (`bankroll_usd` do snapshot). */
  account: { equityUsd: number; unrealizedUsd: number; leverage: number | null } | null = null;
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
  quoteSize(_mid = 100, notional?: number) { return notional ? Math.round((notional / 100) * 1e5) / 1e5 : 0.01; }
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

/** F5 — serie plana: hl2 = 95 = a propria EMA, logo s = 0 (caixa). `newer = 1` = H1 nova. */
function sigmaBarsFlat(now: number, newer = 0) {
  const step1h = 3_600_000;
  const last1h = Math.floor(now / step1h) * step1h - (2 - newer) * step1h;
  return Array.from({ length: 30 }, (_, i) => ({ ts: last1h - (29 - i) * step1h, high: 96, low: 94, close: 95 }));
}

/** Doze velas de 5m dentro da mesma H1: o sigma nao as le, mas o tick corre nelas. */
function sigmaBars5m(now: number) {
  const step5 = 300_000;
  const last5 = Math.floor(now / step5) * step5 - step5;
  return Array.from({ length: 12 }, (_, i) => ({ ts: last5 - (11 - i) * step5, high: 110, low: 90, close: 100 }));
}

/**
 * O `.env` do clone traz `POLICY=jev`, e o portao do F4 e a mecanica do F5 so correm com o
 * sigma ligado. Os testes deste bloco ligam-no aqui — e o `afterAll` no fim do ficheiro repoe.
 */
function sigmaTrader(market: FakeMarket, ledger: Ledger) {
  (config as { policy: string }).policy = "sigma";
  return new Trader(
    market as unknown as Market,
    new MockModel() as unknown as Model,
    () => {},
    () => {},
    () => {},
    { policy: new SigmaPolicy(), ledger },
  );
}

test("sigma F6: equity 100 e lev 1 -> entrada de 1.0; com 110 o episodio seguinte abre 1.1", async () => {
  const now = Date.now();
  let bars = sigmaBars1h(now, 0, "up");
  const market = new FakeMarket();
  // O saldo da sleeve e a mesma regua que o produto ja usa (`bankroll_usd` do snapshot, que sai
  // da equity do venue quando existe). Sem conta no duplo, a regua e o config.
  (config as { bankrollUsd: number }).bankrollUsd = 100;
  market.candleBars1h = () => bars;
  market.candleBars5m = () => [];
  const ledger = new Ledger(`${DIR}/${++seq}`);
  const trader = sigmaTrader(market, ledger);
  const feed = new TradeFeed();
  trader.attachTradeFeed(feed);
  await trader.onBlock(1);
  await Bun.sleep(30);
  expect(market.sends.length).toBe(1);
  expect(market.sends[0]!.size).toBe(1); // 100 / mid 100
  const d1 = ledger.read("BTC", today())[0] as { equity?: number; notional?: number; leverage?: number };
  expect(d1.equity).toBe(100);
  expect(d1.notional).toBe(100);
  expect(d1.leverage).toBe(1);

  // O primeiro episodio enche e o saldo sobe: o episodio seguinte dimensiona pelo saldo novo.
  feed.setTick(2);
  feed.pushPrint({ price: 99.9, size: 1, side: "sell" });
  await trader.onBlock(2);
  await Bun.sleep(60);
  (config as { bankrollUsd: number }).bankrollUsd = 110;
  bars = sigmaBars1h(now, 1, "down"); // H1 nova com o s virado: fecha o velho e abre o novo
  market.sends = [];
  await trader.onBlock(3);
  await Bun.sleep(60);
  expect(market.sends.length).toBe(2);
  expect(market.sends[0]).toMatchObject({ side: "sell", reduceOnly: true, taker: true });
  expect(market.sends[0]!.size).toBe(1); // desmonta o que esta — o tamanho antigo
  expect(market.sends[1]).toMatchObject({ side: "sell", reduceOnly: false, taker: false });
  expect(market.sends[1]!.size).toBe(1.1); // 110 / mid 100
  const decisoes = ledger.read("BTC", today()).filter((l) => l.kind === "decision") as {
    equity?: number; notional?: number;
  }[];
  expect(decisoes.at(-1)!.equity).toBe(110);
  expect(decisoes.at(-1)!.notional).toBe(110);
});

test("sigma F6: caixa desmonta o que esta e nao abre nada, sem notional", async () => {
  const now = Date.now();
  let bars = sigmaBars1h(now, 0, "up");
  const market = new FakeMarket();
  (config as { bankrollUsd: number }).bankrollUsd = 100;
  market.candleBars1h = () => bars;
  market.candleBars5m = () => [];
  const ledger = new Ledger(`${DIR}/${++seq}`);
  const trader = sigmaTrader(market, ledger);
  const feed = new TradeFeed();
  trader.attachTradeFeed(feed);
  await trader.onBlock(1);
  await Bun.sleep(30);
  feed.setTick(2);
  feed.pushPrint({ price: 99.9, size: 1, side: "sell" });
  await trader.onBlock(2);
  await Bun.sleep(60);
  bars = sigmaBarsFlat(now, 1);
  market.sends = [];
  await trader.onBlock(3);
  await Bun.sleep(60);
  expect(market.sends.length).toBe(1); // so o flatten
  expect(market.sends[0]).toMatchObject({ reduceOnly: true, taker: true });
  const d = ledger.read("BTC", today()).filter((l) => l.kind === "decision").at(-1) as { notional?: number };
  expect(d.notional).toBeUndefined();
});

test("sigma F5: o preco do ALO e o touch; recusado, um tick para tras (continua maker)", () => {
  // A espera e uma constante do codigo, nao um knob de `.env`.
  expect(SIGMA_FILL.ALO_WAIT_MS).toBe(8000);
  expect(SIGMA_FILL.MAKER_FEE_BPS).toBe(1.5);
  expect(SIGMA_FILL.TAKER_FEE_BPS).toBe(4.5);
  const b: Book = { ...book, bid: 99.9, ask: 100.1 };
  expect(quotePrice("buy", b, 5, 0)).toBe(99.9); // best bid
  expect(quotePrice("sell", b, 5, 0)).toBe(100.1); // best ask
  expect(quotePrice("buy", b, 5, -1)).toBeLessThan(99.9); // um tick para tras
  expect(quotePrice("sell", b, 5, -1)).toBeGreaterThan(100.1);
  expect(quotePrice("buy", b, 5, -1)).toBeLessThan(b.ask); // continua maker
  expect(quotePrice("sell", b, 5, -1)).toBeGreaterThan(b.bid);
});

test("sigma F5: ALO no touch que enche -> sem segundo envio e fill_role=maker", async () => {
  const prevWait = SIGMA_FILL.ALO_WAIT_MS;
  SIGMA_FILL.ALO_WAIT_MS = 40;
  try {
    const now = Date.now();
    const market = new FakeMarket();
    market.candleBars1h = () => sigmaBars1h(now);
    market.candleBars5m = () => [];
    const ledger = new Ledger(`${DIR}/${++seq}`);
    const trader = sigmaTrader(market, ledger);
    const feed = new TradeFeed();
    trader.attachTradeFeed(feed);
    await trader.onBlock(1);
    await Bun.sleep(30);
    expect(market.sends.length).toBe(1); // o ALO

    // O ALO esta no bid: um print ao bid enche-o (o sim fill do dry run).
    feed.setTick(2);
    feed.pushPrint({ price: 99.9, size: 1, side: "sell" });
    await trader.onBlock(2);
    await Bun.sleep(90); // passa o prazo de espera
    await trader.onBlock(3);
    await Bun.sleep(60);
    expect(market.sends.length).toBe(1); // nenhum segundo envio
    const fills = ledger.read("BTC", today()).filter((l) => l.kind === "fill") as {
      fill_role?: string; unfilled?: number; fee_bps?: number; fill_bps?: number; mid_at_send?: number;
    }[];
    expect(fills.length).toBe(1);
    expect(fills[0]!.fill_role).toBe("maker");
    expect(fills[0]!.unfilled).toBe(0);
    expect(fills[0]!.fee_bps).toBe(SIGMA_FILL.MAKER_FEE_BPS);
    expect(typeof fills[0]!.mid_at_send).toBe("number");
  } finally {
    SIGMA_FILL.ALO_WAIT_MS = prevWait;
  }
});

test("sigma F5: caixa com posicao -> um Ioc reduce-only, sem espera", async () => {
  const now = Date.now();
  let bars = sigmaBars1h(now, 0, "up");
  const market = new FakeMarket();
  market.candleBars1h = () => bars;
  market.candleBars5m = () => [];
  const ledger = new Ledger(`${DIR}/${++seq}`);
  const trader = sigmaTrader(market, ledger);
  const feed = new TradeFeed();
  trader.attachTradeFeed(feed);
  await trader.onBlock(1);
  await Bun.sleep(30);
  expect(market.sends.length).toBe(1); // entrada ALO

  feed.setTick(2);
  feed.pushPrint({ price: 99.9, size: 1, side: "sell" }); // o ALO enche: fica posicao
  await trader.onBlock(2);
  await Bun.sleep(60);

  // H1 nova com o s exactamente na EMA (s=0 -> caixa), com posicao aberta: flatten de hoje.
  bars = sigmaBarsFlat(now, 1);
  market.sends = [];
  await trader.onBlock(3);
  await Bun.sleep(60);
  expect(market.sends.length).toBe(1);
  expect(market.sends[0]).toMatchObject({ reduceOnly: true, taker: true });
  expect(market.sends[0]!.size).toBeGreaterThan(0); // o que o ALO abriu, seja qual for o saldo
});

test("sigma F5 · F4: caixa repetido na MESMA H1 nao desmonta nada (o portao segura)", async () => {
  const now = Date.now();
  let bars = sigmaBars1h(now, 0, "up");
  const market = new FakeMarket();
  market.candleBars1h = () => bars;
  market.candleBars5m = () => [];
  const ledger = new Ledger(`${DIR}/${++seq}`);
  const trader = sigmaTrader(market, ledger);
  const feed = new TradeFeed();
  trader.attachTradeFeed(feed);
  await trader.onBlock(1);
  await Bun.sleep(30);
  feed.setTick(2);
  feed.pushPrint({ price: 99.9, size: 1, side: "sell" }); // abre posicao
  await trader.onBlock(2);
  await Bun.sleep(60);

  bars = sigmaBarsFlat(now, 1); // H1 nova com s=0: a decisao manda caixa
  market.sends = [];
  await trader.onBlock(3);
  await Bun.sleep(60);
  expect(market.sends.length).toBe(1); // o flatten da H1 nova (o caso legitimo)
  expect(market.sends[0]).toMatchObject({ reduceOnly: true, taker: true });

  // O MESMO bloco outra vez: sem H1 nova, o portao segura — sem ALO e sem taker. Sem o portao,
  // o sigma voltaria a mandar caixa e isto era um segundo flatten.
  market.sends = [];
  await trader.onBlock(4);
  await Bun.sleep(60);
  await trader.onBlock(5);
  await Bun.sleep(60);
  expect(market.sends.length).toBe(0);
  // Sem H1 nova o tick e um hold: nem ALO nem taker. (A linha do fill do ALO so sai quando a
  // espera real de 8 s passa — este teste e do portao, nao da mecanica.)
});

test("sigma F5: ALO que nao enche -> exactamente uma Ioc do resto (taker)", async () => {
  const prevWait = SIGMA_FILL.ALO_WAIT_MS;
  SIGMA_FILL.ALO_WAIT_MS = 40;
  try {
    const now = Date.now();
    const market = new FakeMarket();
    market.candleBars1h = () => sigmaBars1h(now);
    market.candleBars5m = () => [];
    const ledger = new Ledger(`${DIR}/${++seq}`);
    const trader = sigmaTrader(market, ledger);
    await trader.onBlock(1);
    await Bun.sleep(30);
    expect(market.sends.length).toBe(1);

    await Bun.sleep(60); // passa o prazo
    await trader.onBlock(2);
    await Bun.sleep(60);
    expect(market.sends.length).toBe(2); // ALO + uma Ioc
    expect(market.sends[1]).toMatchObject({ side: "buy", taker: true, reduceOnly: false });
    expect(market.sends[1]!.size).toBe(market.sends[0]!.size); // o resto = o que nao encheu
    const fills = ledger.read("BTC", today()).filter((l) => l.kind === "fill") as { fill_role?: string; unfilled?: number }[];
    expect(fills.length).toBe(1);
    expect(fills[0]!.fill_role).toBe("taker"); // o ALO nao encheu nada
    expect(fills[0]!.unfilled).toBeGreaterThan(0);

    await trader.onBlock(3);
    await Bun.sleep(60);
    expect(market.sends.length).toBe(2); // e so uma: sem chase, sem segundo ALO
  } finally {
    SIGMA_FILL.ALO_WAIT_MS = prevWait;
  }
});

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
