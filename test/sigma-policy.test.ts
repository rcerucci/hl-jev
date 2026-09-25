import { describe, expect, test } from "bun:test";
import { SIGMA, SigmaPolicy, cycleTsMs, lastClosedH1, sigmaRaw, sigmaStep } from "../src/policy/sigma";
import { config, resolvePolicy } from "../src/config";
import type { SigmaBar } from "../src/risk/types";

const H = 3_600_000;
const T0 = Date.UTC(2026, 8, 25, 0, 0, 0);

/** Serie H1 sintetica: uma barra por hora a partir de T0. */
function serie(rows: { high: number; low: number; close: number }[]): SigmaBar[] {
  return rows.map((r, i) => ({ t: T0 + i * H, high: r.high, low: r.low, close: r.close }));
}
/** `n` barras planas: hl2 = px (high px+1, low px-1) e close px. */
const plana = (n: number, px = 100) => Array.from({ length: n }, () => ({ high: px + 1, low: px - 1, close: px }));
/** O instante em que a barra `i` esta fechada. */
const fechoDe = (i: number) => T0 + i * H + H;
const cid = (ms: number, sleeve = "BTC") =>
  `${new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}-${sleeve}`;

describe("sigma · raw so olha para o s (sem u, sem canal, sem chao/tecto)", () => {
  test("s>0 buy, s<0 sell, s=0 caixa", () => {
    expect(sigmaRaw(1)).toBe("buy");
    expect(sigmaRaw(-1)).toBe("sell");
    expect(sigmaRaw(0)).toBe("caixa");
    expect(sigmaRaw(0.0001)).toBe("buy");
  });

  test("o `raw` nao aceita u: a assinatura tem um argumento so", () => {
    expect(sigmaRaw.length).toBe(1);
  });
});

describe("sigma · passo na vela fechada", () => {
  const base = plana(30); // 30 barras em 100 -> EMA = 100 na barra seguinte
  test("sem historico para a EMA nao inventa lado", () => {
    expect(sigmaStep(serie(plana(10)), fechoDe(9), 0)).toBeNull();
  });

  test("veto de pavio: so o wick cruzou, o close ficou no lado velho", () => {
    // hl2 = 101 (acima da EMA), close = 98 (abaixo). s vigente = -1.
    const bars = serie([...base, { high: 106, low: 96, close: 98 }]);
    const got = sigmaStep(bars, fechoDe(30), -1);
    expect(got).not.toBeNull();
    expect(got!.hl2).toBe(101);
    expect(got!.s).toBe(-1); // mantem
    expect(got!.veto).toBe(true);
  });

  test("close que confirma o lado novo flipa", () => {
    const bars = serie([...base, { high: 106, low: 96, close: 104 }]);
    const got = sigmaStep(bars, fechoDe(30), -1);
    expect(got!.s).toBe(1);
    expect(got!.veto).toBe(false);
  });

  test("sem flip a caminho nao ha veto (s ja do lado novo)", () => {
    const bars = serie([...base, { high: 106, low: 96, close: 98 }]);
    const got = sigmaStep(bars, fechoDe(30), 1);
    expect(got!.s).toBe(1);
    expect(got!.veto).toBe(false);
  });

  test("sem lookahead: uma barra FUTURA nao muda o s da barra fechada", () => {
    const bars = serie([...base, { high: 106, low: 96, close: 104 }]);
    const futuro = serie([...base, { high: 106, low: 96, close: 104 }, { high: 40, low: 20, close: 30 }]);
    const a = sigmaStep(bars, fechoDe(30), -1);
    const b = sigmaStep(futuro, fechoDe(30), -1);
    expect(b!.s).toBe(a!.s);
    expect(b!.veto).toBe(a!.veto);
    expect(lastClosedH1(futuro, fechoDe(30))).toBe(30); // a futura nao entra
  });

  test("a vela lida e a ultima fechada no instante do ciclo", () => {
    const bars = serie([...base, { high: 106, low: 96, close: 104 }]);
    expect(lastClosedH1(bars, T0 + 30 * H + H - 1)).toBe(29); // um ms antes: ainda nao fechou
    expect(lastClosedH1(bars, T0 + 30 * H + H)).toBe(30);
  });
});

describe("sigma · a policy", () => {
  test("sem features nao inventa lado: caixa", async () => {
    const p = new SigmaPolicy();
    const v = await p.decide("state", cid(T0), { returns_bps: { last1: 0, last5: 0, last20: 0 } });
    expect(v.raw).toBe("caixa");
    expect(v.act).toBe("hold");
    expect(v.model).toBe("sigma");
    expect(v.wick_veto).toBe(false);
  });

  test("5m sozinho nao muda s: dois ciclos na mesma hora, mesmo raw", async () => {
    const p = new SigmaPolicy();
    const bars = serie([...plana(30), { high: 106, low: 96, close: 104 }]);
    const ctx = { returns_bps: { last1: 0, last5: 0, last20: 0 }, h1: bars };
    const primeiro = await p.decide("s", cid(T0 + 30 * H + H), ctx);
    const segundo = await p.decide("s", cid(T0 + 30 * H + H + 240_000), ctx); // +4 min, mesma H1
    expect(primeiro.raw).toBe("buy");
    expect(segundo.raw).toBe("buy");
    expect(segundo.signal).toBe("hold"); // o raw nao mudou
  });

  test("veto no pavio: a policy mantem o s e marca wick_veto", async () => {
    const p = new SigmaPolicy();
    // Serie que deixa s = -1: tudo abaixo da EMA no fim.
    const caindo = serie([...plana(30), { high: 99, low: 89, close: 90 }, { high: 92, low: 82, close: 83 }]);
    const a = await p.decide("s", cid(T0 + 31 * H + H), { returns_bps: { last1: 0, last5: 0, last20: 0 }, h1: caindo });
    expect(a.raw).toBe("sell");
    // Agora o poke de pavio: hl2 acima da EMA, close abaixo.
    const poke = serie([...plana(30), { high: 106, low: 96, close: 98 }]);
    const b = await p.decide("s", cid(T0 + 30 * H + H), { returns_bps: { last1: 0, last5: 0, last20: 0 }, h1: poke });
    expect(b.wick_veto).toBe(true);
    expect(b.raw).toBe("sell"); // o s nao virou
  });

  test("u nao entra no raw do sigma: o mesmo h1 com u oposto da o mesmo veredicto", async () => {
    const p1 = new SigmaPolicy();
    const p2 = new SigmaPolicy();
    const bars = serie([...plana(30), { high: 106, low: 96, close: 104 }]);
    const core = { returns_bps: { last1: 0, last5: 0, last20: 0 }, h1: bars };
    const baixo = await p1.decide("s", cid(T0 + 30 * H + H), { ...core, u: 0.01 });
    const alto = await p2.decide("s", cid(T0 + 30 * H + H), { ...core, u: 0.99 });
    expect(baixo.raw).toBe(alto.raw);
    expect(baixo.act).toBe(alto.act);
    expect(baixo.act_conf).toBe(alto.act_conf);
    expect(baixo.raw).toBe("buy");
  });
});

describe("sigma · ligacao", () => {
  test("POLICY=sigma resolve", () => {
    expect(resolvePolicy({ POLICY: "sigma" })).toBe("sigma");
    expect(resolvePolicy({ POLICY: " SIGMA " })).toBe("sigma");
  });

  test("cycleTsMs le o instante do proprio id", () => {
    expect(cycleTsMs("20260925T000000Z-BTC")).toBe(T0);
    expect(cycleTsMs("20260925T013000Z-SOL")).toBe(T0 + 1.5 * H);
    expect(cycleTsMs("lixo")).toBe(0);
  });

  test("config.sigma.emaN e a constante do H1, nao um numero solto", () => {
    expect(config.sigma.emaN).toBe(24);
  });
});
