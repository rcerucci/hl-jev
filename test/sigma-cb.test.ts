import { describe, expect, test } from "bun:test";
import { config } from "../src/config";
import { SigmaPolicy, cbStep, isFlip, newCbState } from "../src/policy/sigma";
import { planFromRisk } from "../src/plan";
import { riskIntent } from "../src/risk/intent";
import { toSnapshot, type SnapshotInput } from "../src/risk/buckets";
import type { RiskIntent, Verdict } from "../src/risk/types";

const H = 3_600_000;
const T0 = Date.UTC(2026, 8, 25, 0, 0, 0);

const plana = (n: number, px = 100) =>
  Array.from({ length: n }, () => ({ high: px + 1, low: px - 1, close: px }));
const SOBE = { high: 110, low: 105, close: 108 }; // hl2 acima da EMA, close confirma
const DESCE = { high: 95, low: 90, close: 92 }; // hl2 abaixo da EMA, close confirma
const POKE = { high: 106, low: 96, close: 98 }; // so o wick cruza: close no lado velho

const serie = (rows: { high: number; low: number; close: number }[]) =>
  rows.map((r, i) => ({ t: T0 + i * H, high: r.high, low: r.low, close: r.close }));
const fecho = (i: number) => T0 + i * H + H; // instante em que a barra i esta fechada
const cid = (ms: number, s = "BTC") =>
  `${new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}-${s}`;
const ctxDe = (bars: ReturnType<typeof serie>) => ({ returns_bps: { last1: 0, last5: 0, last20: 0 }, h1: bars });

/** Tres viradas de lado nas barras 30..33 (uma por hora). */
const tresViradas = [...plana(30), SOBE, DESCE, SOBE, DESCE];
/** Quatro viradas nas barras 30..34: e esta que arma a caixa, porque o limiar do CB e 4. */
const quatroViradas = [...plana(30), SOBE, DESCE, SOBE, DESCE, SOBE];
/** Duas viradas: para no meio. */
const duasViradas = [...plana(30), SOBE, DESCE, SOBE];

function verdict(over: Partial<Verdict> = {}): Verdict {
  return {
    cycle_id: "20260925T000000Z-BTC",
    model: "sigma",
    latency_ms: 0,
    act: "hold",
    act_probs: { buy: 0.08, sell: 0.08, hold: 0.84 },
    act_conf: 0.84,
    too_hostile: 0.1,
    raw_ok: true,
    ...over,
  };
}

function snap(over: Partial<SnapshotInput> = {}) {
  const base: SnapshotInput = {
    ts: Date.UTC(2026, 8, 25, 12, 30, 15),
    sleeve: "BTC",
    book: { bid: 100, ask: 100.1, mid: 100.05, spreadBps: 10, depthBps: { "10": { bid: 1, ask: 1 } } },
    bookAgeMs: 42,
    returnsBps: { last1: 2, last5: 3, last20: 1 },
    volBps: 6,
    prints: { count: 20, buySz: 60, sellSz: 55, cvdSz: 5 },
    position: { side: "flat", size: 0 },
    account: { equityUsd: 100, unrealizedUsd: 0, leverage: 1 },
    fundingBps: 0.02,
    mark: 100,
    bankrollUsd: 100,
    maxLeverage: 40,
    ...over,
  };
  return toSnapshot(base);
}

describe("sigma · virada de lado (o que conta para o CB)", () => {
  test("hold e veto nao sao viradas; mudanca de lado e", () => {
    expect(isFlip("buy", "sell")).toBe(true);
    expect(isFlip("sell", "buy")).toBe(true);
    expect(isFlip("buy", "buy")).toBe(false);
    expect(isFlip(undefined, "buy")).toBe(false);
    expect(isFlip("buy", "caixa")).toBe(false);
    expect(isFlip("caixa", "buy")).toBe(false);
  });
});

describe("sigma · o passo do CB (unidade = H1 fechada)", () => {
  test("4 viradas em 12 h armam 6 h de caixa (o limiar e 4)", () => {
    const st = newCbState();
    expect(cbStep(st, fecho(30), false).active).toBe(false);
    expect(cbStep(st, fecho(31), true).flips_12h).toBe(1);
    expect(cbStep(st, fecho(32), true).flips_12h).toBe(2);
    expect(cbStep(st, fecho(33), true).flips_12h).toBe(3);
    const armado = cbStep(st, fecho(34), true);
    expect(armado.flips_12h).toBe(4);
    expect(armado.active).toBe(true);
    expect(armado.until).toBe(fecho(34) + config.sigma.cbCaixaMs);
  });

  test("3 viradas, com o limiar em 4, nao armam (a fronteira)", () => {
    const st = newCbState();
    cbStep(st, fecho(31), true);
    cbStep(st, fecho(32), true);
    const tres = cbStep(st, fecho(33), true);
    expect(tres.flips_12h).toBe(3);
    expect(tres.active).toBe(false);
    expect(tres.until).toBe(0);
  });

  test("2 viradas nao disparam", () => {
    const st = newCbState();
    cbStep(st, fecho(31), true);
    const dois = cbStep(st, fecho(32), true);
    expect(dois.active).toBe(false);
    expect(dois.flips_12h).toBe(2);
    expect(dois.until).toBe(0);
  });

  test("a mesma H1 repetida nao conta duas vezes (o 5m nao vira inventario)", () => {
    const st = newCbState();
    cbStep(st, fecho(31), true);
    const repetido = cbStep(st, fecho(31), true);
    expect(repetido.flips_12h).toBe(1);
  });

  test("fora da janela de 12 h a virada antiga cai", () => {
    const st = newCbState();
    cbStep(st, fecho(0), true);
    cbStep(st, fecho(1), true); // duas viradas em 2 h
    // 13 h depois: a primeira ficou fora da janela, a segunda tambem (o salto passa as duas).
    const tarde = cbStep(st, fecho(0) + 13 * H, true);
    expect(tarde.active).toBe(false);
    expect(tarde.flips_12h).toBe(1);
  });

  test("a janela e de 12 h: uma virada de 11 h atras ainda conta", () => {
    const st = newCbState();
    cbStep(st, fecho(0), true);
    cbStep(st, fecho(11), true); // 11 h depois: dentro da janela
    expect(cbStep(st, fecho(11), true).flips_12h).toBe(2);
  });

  test("ao expirar, o s volta a valer e o contador recomeca", () => {
    const st = newCbState();
    cbStep(st, fecho(31), true);
    cbStep(st, fecho(32), true);
    cbStep(st, fecho(33), true);
    const armado = cbStep(st, fecho(34), true);
    expect(armado.active).toBe(true);
    // Na barra que levanta a caixa, a lista ja foi limpa: so a virada dessa propria barra
    // entra — e na policy ela nem entra, porque o raw anterior e `caixa` (ver o teste da
    // serie, abaixo).
    const depois = cbStep(st, armado.until, true);
    expect(depois.active).toBe(false);
    expect(depois.flips_12h).toBe(1);
    const seguinte = cbStep(st, armado.until, false);
    expect(seguinte.flips_12h).toBe(1); // mesma H1: nao mexe
  });
});

describe("sigma · o CB na policy", () => {
  test("4 viradas em 12 h poe o capital fora do mercado: caixa", async () => {
    const p = new SigmaPolicy();
    const bars = serie(quatroViradas);
    const ctx = ctxDe(bars);
    await p.decide("s", cid(fecho(30)), ctx);
    await p.decide("s", cid(fecho(31)), ctx);
    await p.decide("s", cid(fecho(32)), ctx);
    await p.decide("s", cid(fecho(33)), ctx);
    const v = await p.decide("s", cid(fecho(34)), ctx);
    expect(v.cb_active).toBe(true);
    expect(v.cb_flips_12h).toBe(4);
    expect(v.cb_until).toBe(fecho(34) + config.sigma.cbCaixaMs);
    expect(v.raw).toBe("caixa");
    expect(v.signal).toBe("caixa");
    expect(v.act).toBe("hold");
  });

  test("2 viradas: o s continua a valer", async () => {
    const p = new SigmaPolicy();
    const bars = serie(duasViradas);
    const ctx = ctxDe(bars);
    await p.decide("s", cid(fecho(30)), ctx);
    await p.decide("s", cid(fecho(31)), ctx);
    const v = await p.decide("s", cid(fecho(32)), ctx);
    expect(v.cb_active).toBe(false);
    expect(v.cb_flips_12h).toBe(2);
    expect(v.cb_until).toBe(0);
    expect(v.raw).toBe("buy");
  });

  test("dentro da mesma H1, o tick de 5m nao reforca o CB", async () => {
    const p = new SigmaPolicy();
    const bars = serie(quatroViradas);
    const ctx = ctxDe(bars);
    await p.decide("s", cid(fecho(30)), ctx);
    await p.decide("s", cid(fecho(31)), ctx);
    await p.decide("s", cid(fecho(32)), ctx);
    await p.decide("s", cid(fecho(33)), ctx);
    const armado = await p.decide("s", cid(fecho(34)), ctx);
    const tick = await p.decide("s", cid(fecho(34) + 240_000), ctx); // +4 min, mesma vela
    expect(tick.cb_flips_12h).toBe(armado.cb_flips_12h);
    expect(tick.raw).toBe("caixa");
    expect(tick.wick_veto).toBe(false);
  });

  test("depois das 6 h o s vigente volta a valer", async () => {
    const p = new SigmaPolicy();
    const bars = serie([...quatroViradas, ...plana(7)]); // chega ate a barra 41
    const ctx = ctxDe(bars);
    for (const i of [30, 31, 32, 33, 34]) await p.decide("s", cid(fecho(i)), ctx);
    const v = await p.decide("s", cid(fecho(40)), ctx); // 6 h depois da 4.a virada
    expect(v.cb_active).toBe(false);
    expect(v.cb_until).toBe(0);
    expect(v.cb_flips_12h).toBe(0);
    expect(v.raw).not.toBe("caixa");
  });

  test("o poke de pavio nao conta como virada", async () => {
    const p = new SigmaPolicy();
    const bars = serie([...plana(30), DESCE, POKE]);
    const ctx = ctxDe(bars);
    await p.decide("s", cid(fecho(30)), ctx);
    const v = await p.decide("s", cid(fecho(31)), ctx);
    expect(v.wick_veto).toBe(true);
    expect(v.cb_flips_12h).toBe(0);
    expect(v.cb_active).toBe(false);
    expect(v.raw).toBe("sell"); // o s nao virou
  });
});

describe("sigma · a caixa do CB usa o flatten que ja existe", () => {
  test("cb_chop -> IOC reduce-only da posicao inteira", () => {
    const intent: RiskIntent = {
      cycle_id: "20260925T000000Z-BTC",
      sleeve: "BTC",
      side: "hold",
      urgency: "none",
      reduce_only: false,
      conf: 0.9,
      reason: "cb_chop",
    };
    expect(planFromRisk(intent, 0.5, 0)).toMatchObject({ side: "sell", size: 0.5, reduceOnly: true, taker: true });
    expect(planFromRisk(intent, -0.3, 0)).toMatchObject({ side: "buy", size: 0.3, reduceOnly: true, taker: true });
    expect(planFromRisk(intent, 0, 0)).toBeNull();
  });

  test("o veredicto com cb_active vira a razao cb_chop, distinta do caixa de s=0", () => {
    const comCb = riskIntent({
      cycleId: "20260925T000000Z-BTC",
      sleeve: "BTC",
      verdict: verdict({ raw: "caixa", signal: "caixa", cb_active: true, cb_flips_12h: 3, cb_until: T0 + 10 * H }),
      snap: snap(),
    });
    expect(comCb.reason).toBe("cb_chop");
    expect(comCb.side).toBe("hold");

    const semCb = riskIntent({
      cycleId: "20260925T000000Z-BTC",
      sleeve: "BTC",
      verdict: verdict({ raw: "caixa", signal: "caixa", cb_active: false }),
      snap: snap(),
    });
    expect(semCb.reason).toBe("caixa");
  });

  test("as constantes do CB estao escritas, nao derivadas da tabela", () => {
    expect(config.sigma.cbFlips).toBe(4);
    expect(config.sigma.cbFlipsSource).toBe("config");
    expect(config.sigma.cbWindowMs).toBe(12 * H);
    expect(config.sigma.cbCaixaMs).toBe(6 * H);
  });
});
