/**
 * Teste da politica do ensaio N1 (`sign(last20)`, EPS = 4 bps).
 *
 * O que se pina aqui e o LIMIAR e a ausencia de contexto — as duas maneiras de a regra
 * inventar lado. Sem contexto (uma chamada que nao passe o `PolicyCtx`) a resposta e `hold`:
 * a porta `Policy` continua a funcionar como sempre para quem so manda as palavras.
 */
import { describe, expect, test } from "bun:test";
import { N1, NumericPolicy, numericAct } from "../src/policy/numeric";

describe("N1 · sign(last20) com EPS = 4 bps", () => {
  test("o limiar e fechado nos dois lados (EPS e o GRIND do produto)", () => {
    expect(numericAct(4)).toBe("hold"); // exactamente no limiar: nao e lado
    expect(numericAct(-4)).toBe("hold");
    expect(numericAct(4.0001)).toBe("buy");
    expect(numericAct(-4.0001)).toBe("sell");
    expect(numericAct(0)).toBe("hold");
    expect(numericAct(15.7)).toBe("buy");
    expect(numericAct(-46.8)).toBe("sell");
  });

  test("EPS e uma constante publicada, nao um argumento afinavel na sessao", () => {
    expect(N1.EPS_BPS).toBe(4);
    expect(numericAct(3.9)).toBe("hold");
  });

  test("sem contexto numerico a politica nunca inventa lado", async () => {
    const v = await new NumericPolicy().decide("tight deep dump flat flat extreme mid", "20260923T000000Z-BTC");
    expect(v.act).toBe("hold");
    expect(v.act_conf).toBe(N1.CONF_ON_HOLD);
  });

  test("com contexto, o lado e o da regra e a confianca passa o portao de 0,80", async () => {
    const p = new NumericPolicy();
    const cid = "20260923T000000Z-BTC";
    const up = await p.decide("state", cid, { returns_bps: { last1: 0.1, last5: 1.2, last20: 9.4 } });
    expect(up.act).toBe("buy");
    expect(up.act_conf).toBeGreaterThanOrEqual(0.8);
    expect(up.too_hostile).toBeLessThan(0.65); // o N1 nao tem pergunta de hostilidade
    expect(up.raw_ok).toBe(true);
    expect(up.act_probs.buy).toBeGreaterThan(up.act_probs.hold);

    const down = await p.decide("state", cid, { returns_bps: { last1: -0.1, last5: -2, last20: -11 } });
    expect(down.act).toBe("sell");

    const flat = await p.decide("state", cid, { returns_bps: { last1: 0, last5: 0.3, last20: -2.9 } });
    expect(flat.act).toBe("hold");
  });
});
