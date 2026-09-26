import { expect, test } from "bun:test";
import { config } from "../src/config";
import { ALFA_COINS, alphaRefusal, assertAlphaRun, bootLine, type ResolvedRun } from "../src/gate";

/** A corrida do alfa: sigma, BTC, testnet, dry, 1x, sem chave. */
const base: ResolvedRun = {
  policy: "sigma",
  coins: ["BTC"],
  dryRun: true,
  hlTestnet: true,
  hasSigner: false,
  leverage: 1,
  bankrollUsd: 200,
  maxLiveEquityUsd: config.maxLiveEquityUsd,
};

test("a corrida do alfa passa", () => {
  expect(alphaRefusal(base)).toBeNull();
  expect(() => assertAlphaRun(base)).not.toThrow();
});

test("policy diferente de sigma e recusada", () => {
  expect(alphaRefusal({ ...base, policy: "jev" })).toContain("POLICY=sigma");
  expect(alphaRefusal({ ...base, policy: "stance" })).toContain("POLICY=sigma");
  expect(alphaRefusal({ ...base, policy: "" })).toContain("(vazio)");
});

test("DRY_RUN em mainnet com signer e recusado (meia-live)", () => {
  expect(alphaRefusal({ ...base, hlTestnet: false, hasSigner: true })).toContain("meia-live");
});

test("live em testnet e recusado", () => {
  expect(alphaRefusal({ ...base, dryRun: false, hlTestnet: true, hasSigner: true })).toContain("testnet");
});

test("leverage diferente de 1 e recusado", () => {
  expect(alphaRefusal({ ...base, leverage: 2 })).toContain("1x");
});

test("acima do tecto em live e recusado; no dry o tecto nao se aplica", () => {
  const live = { ...base, dryRun: false, hlTestnet: false, hasSigner: true };
  expect(alphaRefusal({ ...live, bankrollUsd: config.maxLiveEquityUsd + 1 })).toContain("tecto");
  expect(alphaRefusal({ ...live, bankrollUsd: config.maxLiveEquityUsd })).toBeNull();
  expect(alphaRefusal({ ...base, bankrollUsd: config.maxLiveEquityUsd + 500 })).toBeNull();
});

test("moeda fora do alfa e recusada", () => {
  expect(alphaRefusal({ ...base, coins: ["BTC", "ETH"] })).toContain("ETH");
  expect(alphaRefusal({ ...base, coins: ["SOL"] })).toBeNull();
  expect(ALFA_COINS).toEqual(["BTC", "SOL"]);
});

test("live sem signer e recusado; dry com signer tambem", () => {
  const live = { ...base, dryRun: false, hlTestnet: false, bankrollUsd: config.maxLiveEquityUsd };
  expect(alphaRefusal({ ...live, hasSigner: false })).toContain("sem chave");
  expect(alphaRefusal({ ...base, dryRun: true, hasSigner: true })).toContain("simulada");
});

test("quoteInsideTicks fora de 0 e recusado", () => {
  const prev = config.sigma.quoteInsideTicks;
  config.sigma.quoteInsideTicks = 1;
  try {
    expect(alphaRefusal(base)).toContain("touch");
  } finally {
    config.sigma.quoteInsideTicks = prev;
  }
});

test("a recusa levanta com a razao", () => {
  expect(() => assertAlphaRun({ ...base, policy: "dumb" })).toThrow(/porteiro do alfa: policy=dumb/);
});

test("a linha de arranque traz o objecto resolvido e a origem do CB", () => {
  const l = bootLine(base, "BTC");
  for (const t of ["policy=sigma", "coin=BTC", "net=testnet", "dry=true", "lev=1", "cap=$100", "cbFlips=4 (config)", "cbWindow=12h (config)", "cbCaixa=6h (config)", "quoteInside=0", "aloWait=8000ms"]) {
    expect(l).toContain(t);
  }
});

test("o config.sigma tem estes valores, e so estes", () => {
  expect(config.sigma).toEqual({
    emaN: 24,
    cbFlips: 4,
    cbWindowMs: 12 * 3_600_000,
    cbCaixaMs: 6 * 3_600_000,
    aloWaitMs: 8000,
    makerFeeBps: 1.5,
    takerFeeBps: 4.5,
    quoteInsideTicks: 0,
  });
  expect(config.leverage).toBe(1);
  expect(config.bankrollUsd).toBe(200);
});

test("o tamanho do sigma nao vem do QUOTE_USD (estrutural)", async () => {
  const t = await Bun.file("src/trader.ts").text();
  expect(t).toContain("quoteSize(book.mid, notional ?? equity * config.leverage)");
  expect(t).not.toContain("quoteSize(book.mid, config.lab.quoteUsd");
});

test("o send do sigma entra no touch: inside=0 vem do config", async () => {
  const t = await Bun.file("src/trader.ts").text();
  expect(t).toContain("config.sigma.quoteInsideTicks - 1");
  expect(config.sigma.quoteInsideTicks).toBe(0);
});
