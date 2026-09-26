/**
 * GOLDEN do sigma — contra o campo, nao contra si mesmo.
 *
 * Duas camadas, e a segunda e a que falta nas outras fatias:
 *
 * 1. BARRAS REAIS: as velas H1 de SOL que o `src/chart.ts` puxa do venue (janela de 7 dias), fixadas
 *    em `test/fixtures/sigma-sol-h1.json`. Os valores esperados (`s_der`, `ema_der`, `hl2_der`) foram
 *    calculados por uma implementacao **independente** (Python, fora deste repo) sobre as mesmas
 *    barras, e nao pelo modulo que este teste exercita. Se as duas implementacoes divergirem, o teste
 *    cai - e nao ha como o modulo "concordar consigo proprio".
 *
 * 2. DECISOES REAIS: as 13 decisoes que o motor gravou no ledger da VPS em 26 set 2026 (uma por H1
 *    fechada, mais os arranques). O que se compara e o **lado executado** (`raw`), que e o que o
 *    proprio ledger registou como decisao. O `s` gravado so entra onde ele e do decisor: as linhas
 *    anteriores ao #46 gravavam o `s` de `stanceFeatures` (a divergencia de registo que a issue
 *    nomeia), logo este golden pina o `raw` em todas e o `s` apenas nas linhas pos-#46.
 *
 * Nao ha lookahead: as barras ANTERIORES a vela lida entram na EMA, a vela lida entra no `hl2` e no
 * `close` (veto), e tudo o que vem depois - inclusive a barra H1 em formacao - nao muda nada.
 */
import { describe, expect, test } from "bun:test";
import { sigmaRaw, sigmaStep, lastClosedH1 } from "../src/policy/sigma";
import type { SigmaBar } from "../src/risk/types";
import fixture from "./fixtures/sigma-sol-h1.json";

const H = 3_600_000;

interface GoldenRow {
  cycle_id: string;
  /** O `s` vigente com que o motor decidiu (cadeia dentro da sessao; arranque = 0). */
  s_prev: number;
  /** O lado que o ledger registou como decisao executada. */
  raw_ledger: string;
  /** O `s` gravado no ledger (ver o cabecalho: pre-#46 vinha da outra computacao). */
  s_ledger: number;
  s_der: number;
  raw_der: string;
  ema_der: number;
  hl2_der: number;
  veto_der: boolean;
  bar_t: number;
}

const bars = fixture.bars as SigmaBar[];
const golden = fixture.golden as GoldenRow[];

/** O instante do ciclo, do proprio `cycle_id` (`YYYYMMDDTHHMMSSZ-SLEEVE`). */
const instante = (cid: string) =>
  Date.parse(
    `${cid.slice(0, 4)}-${cid.slice(4, 6)}-${cid.slice(6, 8)}T${cid.slice(9, 11)}:${cid.slice(11, 13)}:${cid.slice(13, 15)}Z`,
  );

/** Fecho da H1 em que o #46 entrou: as linhas a partir daqui gravam o `s` do decisor. */
const POS_46 = Date.parse("2026-09-26T11:35:35Z");

describe("sigma golden · decisoes reais sobre velas reais", () => {
  test("a decisao gravada (raw) e reproduzida pelo modulo em 13 de 13", () => {
    const linhas: string[] = [];
    for (const g of golden) {
      const st = sigmaStep(bars, instante(g.cycle_id), g.s_prev);
      expect(st).not.toBeNull();
      const raw = sigmaRaw(st!.s);
      if (raw !== g.raw_ledger) linhas.push(`${g.cycle_id}: modulo=${raw} ledger=${g.raw_ledger}`);
      expect(raw).toBe(g.raw_ledger);
    }
    expect(linhas).toEqual([]);
  });

  test("a EMA e o hl2 batem com a implementacao independente (Python), casa a casa", () => {
    for (const g of golden) {
      const st = sigmaStep(bars, instante(g.cycle_id), g.s_prev)!;
      expect(Math.abs(st.ema - g.ema_der)).toBeLessThan(1e-9);
      expect(Math.abs(st.hl2 - g.hl2_der)).toBeLessThan(1e-9);
      expect(st.s).toBe(g.s_der);
      expect(st.veto).toBe(g.veto_der);
      // a vela lida e a que fechou no instante do ciclo, e a barra anterior serve de base
      expect(st.closedAt).toBe(g.bar_t + H);
      expect(lastClosedH1(bars, instante(g.cycle_id))).toBe(bars.findIndex((b) => b.t === g.bar_t));
    }
  });

  test("o `s` gravado e o do decisor em todas as linhas pos-#46 (o resto esta nomeado)", () => {
    const pre = golden.filter((g) => instante(g.cycle_id) < POS_46);
    const pos = golden.filter((g) => instante(g.cycle_id) >= POS_46);
    expect(pos.length).toBeGreaterThan(0);
    for (const g of pos) expect(g.s_ledger).toBe(g.s_der);
    // As linhas antigas divergem porque gravavam `ctx.s` (stanceFeatures). Onde divergirem, o `raw`
    // continua a ser o do sigma: e a assinatura do defeito, nao um segundo resultado.
    for (const g of pre.filter((g) => g.s_ledger !== g.s_der)) {
      expect(sigmaRaw(g.s_der)).toBe(g.raw_ledger);
    }
  });

  test("o `s` e o lado: s=0 e caixa, s>0 e buy, s<0 e sell (o raw nao olha para mais nada)", () => {
    for (const g of golden) expect(sigmaRaw(g.s_der)).toBe(g.raw_der);
    expect(sigmaRaw(0)).toBe("caixa");
  });
});

describe("sigma golden · sem lookahead sobre as barras reais", () => {
  const AT = instante("20260926T120001Z");
  const base = sigmaStep(bars, AT, -1)!;

  test("a barra lida e a ultima fechada (11:00Z), nao a que esta em formacao (12:00Z)", () => {
    expect(base.closedAt).toBe(Date.parse("2026-09-26T12:00:00Z"));
    expect(lastClosedH1(bars, AT)).toBe(bars.findIndex((b) => b.t === Date.parse("2026-09-26T11:00:00Z")));
  });

  test("barras futuras absurdas nao mexem no s, na EMA, no hl2 nem no fecho lido", () => {
    const futuras: SigmaBar[] = [
      ...bars,
      { t: AT, high: 1e6, low: 1e6, close: 1e6 },
      { t: AT + 3 * H, high: 2e6, low: 2e6, close: 2e6 },
    ];
    const st = sigmaStep(futuras, AT, -1)!;
    expect(st.s).toBe(base.s);
    expect(st.ema).toBe(base.ema);
    expect(st.hl2).toBe(base.hl2);
    expect(st.closedAt).toBe(base.closedAt);
  });

  test("mexer na barra H1 em formacao nao muda nada", () => {
    const formacao = Date.parse("2026-09-26T12:00:00Z");
    const tortas = bars.map((b) => (b.t === formacao ? { ...b, high: 1e6, low: 1e6, close: 1e6 } : b));
    const st = sigmaStep(tortas, AT, -1)!;
    expect(st.s).toBe(base.s);
    expect(st.ema).toBe(base.ema);
  });

  test("controlo positivo: mexer no passado MUDA a EMA (a sonda nao e cega)", () => {
    const passado = bars.map((b, i) => (i === 5 ? { ...b, high: b.high + 50, low: b.low + 50 } : b));
    expect(sigmaStep(passado, AT, -1)!.ema).not.toBe(base.ema);
  });

  test("controlo positivo: o `close` da barra lida governa o veto, e o `hl2` o lado", () => {
    const i = bars.findIndex((b) => b.t + H === base.closedAt);
    // close do lado velho com hl2 do lado novo: o veto prende o `s` (sPrev = -1)
    const wick = bars.map((b, j) => (j === i ? { ...b, close: 1 } : b));
    const st = sigmaStep(wick, AT, -1)!;
    expect(st.veto).toBe(true);
    expect(st.s).toBe(-1);
    // e o hl2 continua a mandar no candidato:
    expect(sigmaStep(bars, AT, -1)!.s).toBe(1);
  });
});
