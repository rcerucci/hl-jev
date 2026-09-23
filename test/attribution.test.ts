import { expect, test } from "bun:test";
import type { DecisionLine, OutcomeLine } from "../src/ledger/jsonl";
import { MIN_HIGH_CONF, formatTable, summarise, verdictOf, winrate, winrateAt050 } from "../src/ledger/attribution";

const CONF = 0.8;
/** Amostra suficiente para o veredicto concluir (o minimo declarado + folga). */
const N = MIN_HIGH_CONF + 5;

function decision(model: string, act: string, conf: number): DecisionLine {
  return {
    kind: "decision",
    cycle_id: "20260923T120000Z-BTC",
    ts: Date.UTC(2026, 8, 23, 12, 0, 0),
    sleeve: "BTC",
    state: "normal deep two_way flat flat pay_neutral mid",
    verdict: { model, act, act_conf: conf },
    intent: { side: act, urgency: "maker" },
    fill: null,
  };
}

function outcome(hit: boolean | null, conf: number, miss = false): OutcomeLine {
  return {
    kind: "outcome",
    cycle_id: "20260923T120000Z-BTC",
    mark_then: 100,
    mark_plus_15m: hit ? 101 : 99,
    funding_accrued: 0.00001,
    dir_after: hit === null ? "flat" : hit ? "up" : "down",
    jev_side: "buy",
    directional_hit: hit,
    conf_was: conf,
    high_conf_miss: miss,
    horizon_secs: 900,
  };
}

const ciclo = (model: string, act: string, conf: number, out: OutcomeLine | null) => ({ decision: decision(model, act, conf), outcome: out });

test("a tabela separa Jev e controle pelo modelo do veredicto", () => {
  const stats = summarise(
    [
      ciclo("jev-1.13.0", "buy", 0.9, outcome(true, 0.9)),
      ciclo("jev-1.13.0", "buy", 0.9, outcome(false, 0.9, true)),
      ciclo("jev-1.13.0", "hold", 0.4, outcome(null, 0.4)),
      ciclo("dumb", "buy", 0.9, outcome(true, 0.9)),
      ciclo("dumb", "buy", 0.9, outcome(true, 0.9)),
    ],
    CONF,
  );
  const jev = stats.find((s) => s.policy === "jev")!;
  const dumb = stats.find((s) => s.policy === "dumb")!;
  expect(jev).toMatchObject({ cycles: 3, withOutcome: 3, decided: 3, holds: 1, highConf: 2, highConfHits: 1, highConfMisses: 1, highConfMissFlags: 1 });
  expect(winrate(jev)).toBeCloseTo(0.5, 6);
  expect(dumb).toMatchObject({ cycles: 2, highConf: 2, highConfHits: 2, highConfMisses: 0 });
  expect(winrate(dumb)).toBe(1);
  expect(jev.fundingAvg).toBeCloseTo(0.00001, 10);
});

test("uma falha do Jev nao e uma segunda politica nem um hold decidido", () => {
  // A falha sai com o model id de configuracao ("jev-latest") no `model`; tem de
  // cair na familia jev e contar como falha, nao abrir coluna nem inflar %hold.
  const falha = { ...decision("jev-latest", "hold", 0), verdict: { model: "jev-latest", act: "hold", act_conf: 0, raw_ok: false, note: "timeout" } };
  const stats = summarise([{ decision: falha, outcome: null }, ciclo("jev-1.13.0", "hold", 0.4, null)], CONF);
  expect(stats.length).toBe(1);
  expect(stats[0]!).toMatchObject({ policy: "jev", cycles: 2, frozen: 1, decided: 1, holds: 1 });
  const [limiar, header, row] = formatTable(stats);
  expect(limiar).toContain("limiar");
  expect(header).toContain("falhas");
  expect(header).toContain("decididos");
  // Uma falha nao entra no denominador das partilhas: o unico ciclo decidido e hold.
  expect(row).toContain("100.0%");
});

test("hold e mercado parado ficam fora do denominador do acerto", () => {
  const stats = summarise(
    [
      ciclo("jev-1.13.0", "buy", 0.9, outcome(true, 0.9)),
      ciclo("jev-1.13.0", "hold", 0.95, outcome(null, 0.95)),
      ciclo("jev-1.13.0", "sell", 0.9, outcome(null, 0.9)),
    ],
    CONF,
  )[0]!;
  expect(stats.highConfHits + stats.highConfMisses).toBe(1);
  expect(stats.flats).toBe(2);
  expect(winrate(stats)).toBe(1);
});

test("ciclo sem outcome aparece na coluna, mas nao na conta do acerto", () => {
  const stats = summarise([ciclo("jev-1.13.0", "buy", 0.9, null)], CONF)[0]!;
  expect(stats).toMatchObject({ cycles: 1, withOutcome: 0, highConf: 1 });
  expect(winrate(stats)).toBe(null);
  expect(formatTable([stats])[2]).toContain("--");
});

test("com amostra pequena o veredicto recusa concluir", () => {
  const stats = summarise(
    [
      ciclo("jev-1.13.0", "buy", 0.9, outcome(true, 0.9)),
      ciclo("dumb", "buy", 0.9, outcome(true, 0.9)),
    ],
    CONF,
  );
  const lines = verdictOf(stats);
  expect(lines[0]).toContain("amostra insuficiente");
  expect(lines[0]).toContain(`minimo ${MIN_HIGH_CONF}`);
});

test("amostra suficiente: o Jev bate o controle", () => {
  const amostra: ReturnType<typeof ciclo>[] = [];
  for (let i = 0; i < N; i++) amostra.push(ciclo("jev-1.13.0", "buy", 0.9, outcome(true, 0.9)));
  for (let i = 0; i < N; i++) amostra.push(ciclo("dumb", "buy", 0.9, outcome(i === 0, 0.9)));
  const stats = summarise(amostra, CONF);
  expect(verdictOf(stats)[0]).toContain("o Jev bate o controle");
});

test("amostra suficiente: controle empata ou ganha proibe noite e mainnet", () => {
  const amostra: ReturnType<typeof ciclo>[] = [];
  for (let i = 0; i < N; i++) amostra.push(ciclo("jev-1.13.0", "buy", 0.9, outcome(true, 0.9)));
  for (let i = 0; i < N; i++) amostra.push(ciclo("dumb", "buy", 0.9, outcome(true, 0.9)));
  const stats = summarise(amostra, CONF);
  const lines = verdictOf(stats);
  expect(lines[0]).toContain("empata ou ganha");
  expect(lines[1]).toContain("NAO ligar a noite");
});

test("sem uma das colunas o veredicto diz o que falta em vez de inventar", () => {
  const soJev = summarise([ciclo("jev-1.13.0", "buy", 0.9, outcome(true, 0.9))], CONF);
  expect(verdictOf(soJev)[0]).toContain("falta uma das colunas");
});

test("a tabela imprime o limiar e as colunas da spec 9.4", () => {
  const stats = summarise([ciclo("jev-1.13.0", "buy", 0.9, outcome(true, 0.9))], CONF);
  const out = formatTable(stats).join("\n");
  expect(out).toContain("limiar de confianca: 0.8");
  for (const col of ["ciclos", "c/outcome", "%hold", "n_altaconf", "n_lados", "graduados", "acuerto", "diag@0.50", "funding"]) {
    expect(out).toContain(col);
  }
  // A regra do V1 tem de estar impressa, nao so no comentario do codigo.
  expect(out).toContain("NUNCA promove");
  expect(out).toContain("a amostra da spec 9.4");
});

test("o hold de alta confianca conta em n_altaconf e nao em n_lados", () => {
  // O run de 30 min deu 7 ciclos a conf>=0,80, todos hold: sao decisao, nao lado.
  const stats = summarise(
    [
      ciclo("jev-1.13.0", "hold", 0.91, outcome(null, 0.91)),
      ciclo("jev-1.13.0", "hold", 0.87, outcome(null, 0.87)),
      ciclo("jev-1.13.0", "buy", 0.9, outcome(true, 0.9)),
    ],
    CONF,
  )[0]!;
  expect(stats.highConf).toBe(3);
  expect(stats.highConfSides).toBe(1);
  expect(stats.highConfHits + stats.highConfMisses).toBe(1);
  expect(winrate(stats)).toBe(1);
});

test("a coluna diag@0.50 ve o lado que o gate bloqueia — e nunca promove", () => {
  // 50 lados a 0,60: o gate de 0,80 nao deixa passar nenhum, o diagnostico
  // mostra-os. O veredicto tem de continuar a recusar, e nao pode ler este acerto.
  const amostra: ReturnType<typeof ciclo>[] = [];
  for (let i = 0; i < 50; i++) amostra.push(ciclo("jev-1.13.0", "buy", 0.6, outcome(true, 0.6)));
  for (let i = 0; i < 25; i++) amostra.push(ciclo("dumb", "buy", 0.6, outcome(true, 0.6)));
  const stats = summarise(amostra, CONF);
  const jev = stats.find((s) => s.policy === "jev")!;
  expect(jev.highConfSides).toBe(0);
  expect(jev.sidesAt050).toBe(50);
  expect(winrateAt050(jev)).toBe(1);
  expect(winrate(jev)).toBe(null);
  const linhas = verdictOf(stats).join(" ");
  expect(linhas).toContain("amostra insuficiente");
  expect(linhas).toContain("diag@0.50");
  expect(linhas).toContain("nao conta para este veredicto");
  expect(linhas).not.toContain("bate o controle");
  // Ha lados abaixo do limiar: a causa de n_lados=0 e o GATE, e o veredicto diz isso.
  expect(linhas).toContain("o gate e que trava");
});

test("sem lado nenhum, o veredicto diz que o gate nao e a causa", () => {
  // O cenario real da sessao viva (2559 decisoes, todas hold): se nao ha lado
  // nem abaixo de 0,50, baixar o limiar nao muda nada — e isso tem de estar dito.
  const amostra: ReturnType<typeof ciclo>[] = [];
  for (let i = 0; i < 30; i++) amostra.push(ciclo("jev-1.13.0", "hold", 0.9, outcome(null, 0.9)));
  for (let i = 0; i < 30; i++) amostra.push(ciclo("dumb", "hold", 0.5, outcome(null, 0.5)));
  const stats = summarise(amostra, CONF);
  expect(stats.find((s) => s.policy === "jev")!.sidesAny).toBe(0);
  const linhas = verdictOf(stats).join(" ");
  expect(linhas).toContain("nao escolheu um lado NEM abaixo de 0,50");
  expect(linhas).toContain("o gate nao e o que trava");
});
