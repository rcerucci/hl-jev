import { describe, expect, test } from "bun:test";
import { resolveCbFlips, resolveCbHours } from "../src/config";

/**
 * #37 — o circuito de chop pelo ambiente. Os resolvedores sao puros de proposito: recebem o mapa do
 * ambiente, por isso estes testes nao dependem do `.env` da maquina (a suite nao deve ler o `.env`).
 */
describe("o circuito de chop pelo ambiente (#37)", () => {
  test("sem CB_FLIPS o default e 4 e a origem e o config", () => {
    expect(resolveCbFlips({})).toEqual({ value: 4, source: "config" });
  });

  test("CB_FLIPS vence o default e a origem e o env", () => {
    expect(resolveCbFlips({ CB_FLIPS: "6" })).toEqual({ value: 6, source: "env" });
  });

  test("CB_FLIPS vazio conta como ausente", () => {
    expect(resolveCbFlips({ CB_FLIPS: "  " })).toEqual({ value: 4, source: "config" });
  });

  test("valor nao numerico sai como NaN, para o porteiro recusar", () => {
    expect(Number.isNaN(resolveCbFlips({ CB_FLIPS: "abc" }).value)).toBe(true);
  });

  test("a janela e a caixa tem a mesma forma", () => {
    expect(resolveCbHours({}, "CB_WINDOW_H", 12)).toEqual({ value: 12, source: "config" });
    expect(resolveCbHours({ CB_CAIXA_H: "3" }, "CB_CAIXA_H", 6)).toEqual({ value: 3, source: "env" });
  });
});
