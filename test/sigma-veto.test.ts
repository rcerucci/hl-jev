/**
 * F2 — VETO DE PAVIO, contra o campo.
 *
 * A regra (src/policy/sigma.ts:154-155): se o `s` quer virar e so o **wick** cruzou a EMA - o `hl2`
 * passou para o lado novo e o **close ficou no lado velho** - a barra e ignorada e o `s` mantem-se.
 * Um close que confirma flipa. O `wick_veto` do ledger diz que houve veto.
 *
 * O que a suite ja tinha: quatro casos sinteticos de UMA direcao (pavio de cima com `sPrev = -1`).
 * O que falta e o que este ficheiro acrescenta:
 *
 * - as **duas direcoes** (pavio do high e pavio do low) - nos 30 dias reais, 13 dos 18 vetos sao a
 *   direcao que nao estava testada;
 * - o veto sobre **barras reais** (30 dias de SOL e BTC), com a cadeia inteira pelo modulo e a
 *   contagem comparada com uma implementacao **independente** (Python, `test/fixtures/sigma-h1-30d.json`);
 * - as **fronteiras** do veto: `sPrev = 0`, `hl2 == EMA`, `close == EMA`, e a barra seguinte.
 *
 * O campo `wick_veto` no tick fundido (motor -> ledger) tem teste proprio em `fused-tick.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { isFlip, sigmaRaw, sigmaStep } from "../src/policy/sigma";
import type { SigmaBar } from "../src/risk/types";
import fixture from "./fixtures/sigma-h1-30d.json";

const H = 3_600_000;
const T0 = Date.UTC(2026, 8, 1, 0, 0, 0);
const fecho = (i: number) => T0 + i * H + H;

/** 30 barras planas (hl2 = 100) + a barra lida. */
const comBarra = (barra: Omit<SigmaBar, "t">): SigmaBar[] => [
  ...Array.from({ length: 30 }, (_, i) => ({ t: T0 + i * H, high: 101, low: 99, close: 100 })),
  { t: T0 + 30 * H, ...barra },
];

// hl2 105 (acima da EMA 100) com close 98 (abaixo): so o pavio de cima cruzou
const PAVIO_CIMA = { high: 110, low: 100, close: 98 };
// hl2 95 (abaixo) com close 102 (acima): so o pavio de baixo cruzou
const PAVIO_BAIXO = { high: 108, low: 82, close: 102 };
// closes que confirmam
const CONFIRMA_CIMA = { high: 110, low: 100, close: 108 };
const CONFIRMA_BAIXO = { high: 100, low: 90, close: 92 };

describe("sigma F2 · as duas direcoes e o close", () => {
  test("pavio de cima com s=-1: mantem s=-1 e marca veto", () => {
    const st = sigmaStep(comBarra(PAVIO_CIMA), fecho(30), -1)!;
    expect(st.hl2).toBe(105);
    expect(st.close).toBe(98);
    expect(st.veto).toBe(true);
    expect(st.s).toBe(-1);
    expect(sigmaRaw(st.s)).toBe("sell");
  });

  test("pavio de baixo com s=+1: mantem s=+1 e marca veto", () => {
    const st = sigmaStep(comBarra(PAVIO_BAIXO), fecho(30), 1)!;
    expect(st.hl2).toBe(95);
    expect(st.close).toBe(102);
    expect(st.veto).toBe(true);
    expect(st.s).toBe(1);
    expect(sigmaRaw(st.s)).toBe("buy");
  });

  test("close que confirma para cima: flipa para buy, sem veto", () => {
    const st = sigmaStep(comBarra(CONFIRMA_CIMA), fecho(30), -1)!;
    expect(st.s).toBe(1);
    expect(st.veto).toBe(false);
  });

  test("close que confirma para baixo: flipa para sell, sem veto", () => {
    const st = sigmaStep(comBarra(CONFIRMA_BAIXO), fecho(30), 1)!;
    expect(st.s).toBe(-1);
    expect(st.veto).toBe(false);
  });
});

describe("sigma F2 · fronteiras", () => {
  test("sPrev = 0 (arranque): o veto nao existe e o pavio passa (ver #51)", () => {
    const st = sigmaStep(comBarra(PAVIO_CIMA), fecho(30), 0)!;
    expect(st.veto).toBe(false);
    expect(st.s).toBe(1); // o candidato vale: nao ha lado a proteger
  });

  test("hl2 == EMA exactamente: s = 0 -> caixa (nao e virada nem veto)", () => {
    const st = sigmaStep(comBarra({ high: 105, low: 95, close: 98 }), fecho(30), -1)!;
    expect(st.hl2).toBe(st.ema);
    expect(st.s).toBe(0);
    expect(st.veto).toBe(false);
    expect(sigmaRaw(st.s)).toBe("caixa");
  });

  test("close exactamente na EMA: nao conta como lado velho, logo flipa sem veto", () => {
    const st = sigmaStep(comBarra({ high: 110, low: 100, close: 100 }), fecho(30), -1)!;
    expect(st.veto).toBe(false);
    expect(st.s).toBe(1);
  });

  test("a barra SEGUINTE ao veto, com close a confirmar, flipa", () => {
    const bars = [...comBarra(PAVIO_CIMA), { t: T0 + 31 * H, ...CONFIRMA_BAIXO }];
    const vetada = sigmaStep(bars, fecho(30), -1)!;
    expect(vetada.veto).toBe(true);
    const seguinte = sigmaStep(bars, fecho(31), -1)!;
    expect(seguinte.veto).toBe(false);
    expect(seguinte.s).toBe(-1);
  });

  test("o veto nao conta virada para o CB: o lado visto e o mantido", () => {
    const st = sigmaStep(comBarra(PAVIO_CIMA), fecho(30), -1)!;
    // o veto prendeu o s em -1: o evento que chega ao CB e o lado velho, logo nao ha virada
    expect(st.s).toBe(-1);
    expect(isFlip("sell", sigmaRaw(st.s))).toBe(false);
    // e o que o veto recusou era, de facto, uma virada (sRaw = +1) - o CB nao a ve
    expect(isFlip("sell", "buy")).toBe(true);
  });
});

describe("sigma F2 · as barras reais de 30 dias (SOL e BTC)", () => {
  const series = fixture.series as unknown as Record<string, [number, number, number, number][]>;
  const vetos = fixture.vetos as {
    coin: string; bar_t: number; hl2: number; close: number; ema: number;
    s_prev: number; s_der: number; veto: boolean; pavio: "cima" | "baixo";
  }[];
  const contagens = fixture.contagens as Record<string, { viradas: number; vetos: number }>;

  /** Percorre a serie inteira pelo modulo, como o motor faz: uma barra fechada de cada vez. */
  function correr(coin: string) {
    const bars: SigmaBar[] = series[coin]!.map(([t, high, low, close]) => ({ t, high, low, close }));
    let sPrev = 0;
    const achados: { bar_t: number; veto: boolean; s: number; hl2: number; close: number; ema: number }[] = [];
    let viradas = 0;
    for (let i = 24; i < bars.length; i++) {
      const st = sigmaStep(bars.slice(0, i + 1), bars[i]!.t + H, sPrev);
      expect(st).not.toBeNull();
      achados.push({ bar_t: bars[i]!.t, veto: st!.veto, s: st!.s, hl2: st!.hl2, close: st!.close, ema: st!.ema });
      if (st!.veto) expect(st!.s).toBe(sPrev); // o veto mantem SEMPRE o lado vigente
      else if (sPrev !== 0 && st!.s !== 0 && st!.s !== sPrev) viradas++;
      sPrev = st!.s;
    }
    return { achados, viradas };
  }

  test("a contagem de viradas e de vetos bate com a referencia independente", () => {
    for (const coin of ["SOL", "BTC"]) {
      const { achados, viradas } = correr(coin);
      const meus = achados.filter((a) => a.veto).length;
      expect(viradas).toBe(contagens[coin]!.viradas);
      expect(meus).toBe(contagens[coin]!.vetos);
    }
  });

  test("cada veto da referencia acontece naquele instante, com os mesmos numeros", () => {
    for (const v of vetos) {
      const { achados } = correr(v.coin);
      const linha = achados.find((a) => a.bar_t === v.bar_t);
      expect(linha).toBeDefined();
      expect(linha!.veto).toBe(true);
      expect(linha!.s).toBe(v.s_der);
      expect(Math.abs(linha!.hl2 - v.hl2)).toBeLessThan(1e-9);
      expect(Math.abs(linha!.close - v.close)).toBeLessThan(1e-9);
      expect(Math.abs(linha!.ema - v.ema)).toBeLessThan(1e-9);
    }
  });

  test("e nao ha veto nenhum fora da lista (o conjunto, casa a casa)", () => {
    for (const coin of ["SOL", "BTC"]) {
      const { achados } = correr(coin);
      const meus = achados.filter((a) => a.veto).map((a) => a.bar_t).sort((a, b) => a - b);
      const ref = vetos.filter((v) => v.coin === coin).map((v) => v.bar_t).sort((a, b) => a - b);
      expect(meus).toEqual(ref);
    }
  });

  test("nos dados reais as duas direcoes acontecem (o pavio do high e o do low)", () => {
    const cima = vetos.filter((v) => v.pavio === "cima").length;
    const baixo = vetos.filter((v) => v.pavio === "baixo").length;
    expect(cima).toBeGreaterThan(0);
    expect(baixo).toBeGreaterThan(0);
    expect(cima + baixo).toBe(vetos.length);
  });
});
