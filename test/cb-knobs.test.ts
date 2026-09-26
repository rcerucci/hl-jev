/**
 * Issue #37 — o CB configuravel na `main`: default 4 no `src/config.ts`, override por `CB_FLIPS`
 * (e `CB_WINDOW_H` / `CB_CAIXA_H`), a origem impressa na bootLine e o porteiro a recusar valor fora
 * de banda. O teste do subprocesso existe porque so um processo novo prova que o ambiente **real**
 * chega ao `config` e ao motor: `config` e lido no import, uma vez.
 */
import { describe, expect, test } from "bun:test";
import { CB_BAND_MAX_H, CB_DEFAULTS, cbKnobs, config, resolveCbKnobs } from "../src/config";
import { bootLine } from "../src/gate";

const H = 3_600_000;

/** O mesmo `run` do `test/gate.test.ts`: a corrida do alfa, sem tocar no venue. */
const run = {
  policy: "sigma",
  coins: ["BTC"],
  dryRun: true,
  hlTestnet: true,
  hasSigner: false,
  leverage: 1,
  bankrollUsd: 200,
  maxLiveEquityUsd: 100,
};

const cfgUrl = new URL("../src/config.ts", import.meta.url).href;
const gateUrl = new URL("../src/gate.ts", import.meta.url).href;

/** Um `bun -e` limpo: imprime o que o config resolveu e a bootLine que o motor escreveria. */
const probe = `
(async () => {
  const cfg = await import(${JSON.stringify(cfgUrl)});
  const gate = await import(${JSON.stringify(gateUrl)});
  const run = ${JSON.stringify(run)};
  console.log(JSON.stringify({
    flips: cfg.config.sigma.cbFlips,
    windowMs: cfg.config.sigma.cbWindowMs,
    caixaMs: cfg.config.sigma.cbCaixaMs,
    source: cfg.cbKnobs.flips.source,
    line: gate.bootLine(run, "BTC"),
  }));
})().catch((e) => { console.error("recusado: " + e.message); process.exit(1); });
`;

function arranque(env: Record<string, string | undefined>) {
  const r = Bun.spawnSync([process.execPath, "-e", probe], {
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: r.exitCode, out: r.stdout.toString().trim(), err: r.stderr.toString().trim() };
}

describe("CB configuravel (issue #37) · o default vem do config", () => {
  test("sem ambiente, os tres botoes sao os do config: 4 viradas, 12 h, 6 h", () => {
    const k = resolveCbKnobs({});
    expect(k.flips).toEqual({ value: 4, source: "config" });
    expect(k.windowH).toEqual({ value: 12, source: "config" });
    expect(k.caixaH).toEqual({ value: 6, source: "config" });
    expect(CB_DEFAULTS).toEqual({ flips: 4, windowH: 12, caixaH: 6 });
  });

  test("e sao esses mesmos numeros que o motor le (config.sigma)", () => {
    expect(config.sigma.cbFlips).toBe(4);
    expect(config.sigma.cbWindowMs).toBe(12 * H);
    expect(config.sigma.cbCaixaMs).toBe(6 * H);
  });

  test("nada no motor le o ambiente por fora do config (fonte unica)", async () => {
    const policy = await Bun.file("src/policy/sigma.ts").text();
    expect(policy).toContain("config.sigma.cbFlips");
    expect(policy).toContain("config.sigma.cbWindowMs");
    expect(policy).toContain("config.sigma.cbCaixaMs");
    expect(policy).not.toContain("process.env");
  });
});

describe("CB configuravel (issue #37) · o override vence", () => {
  test("CB_FLIPS e os dois da janela sobrepoem-se ao config", () => {
    const k = resolveCbKnobs({ CB_FLIPS: "7", CB_WINDOW_H: "24", CB_CAIXA_H: "3" });
    expect(k.flips).toEqual({ value: 7, source: "env" });
    expect(k.windowH).toEqual({ value: 24, source: "env" });
    expect(k.caixaH).toEqual({ value: 3, source: "env" });
  });

  test("um so override nao arrasta os outros dois", () => {
    const k = resolveCbKnobs({ CB_FLIPS: "9" });
    expect(k.flips).toEqual({ value: 9, source: "env" });
    expect(k.windowH).toEqual({ value: 12, source: "config" });
    expect(k.caixaH).toEqual({ value: 6, source: "config" });
  });

  test("os limites da banda entram (4/12/6 e o extremo 12 numa janela de 12 h)", () => {
    expect(resolveCbKnobs({ CB_FLIPS: "1" }).flips.value).toBe(1);
    expect(resolveCbKnobs({ CB_FLIPS: "12" }).flips.value).toBe(12);
    expect(resolveCbKnobs({ CB_WINDOW_H: String(CB_BAND_MAX_H) }).windowH.value).toBe(CB_BAND_MAX_H);
  });

  test("espaco a volta tolera-se; o valor continua a ser do ambiente", () => {
    expect(resolveCbKnobs({ CB_FLIPS: " 4 " }).flips).toEqual({ value: 4, source: "env" });
  });

  test("o processo arranca com o ambiente a mandar, e a bootLine diz de onde vem", () => {
    const r = arranque({ CB_FLIPS: "7", CB_WINDOW_H: "24", CB_CAIXA_H: "3" });
    expect(r.code).toBe(0);
    const visto = JSON.parse(r.out);
    expect(visto).toMatchObject({ flips: 7, windowMs: 24 * H, caixaMs: 3 * H, source: "env" });
    expect(visto.line).toContain("cbFlips=7 (env)");
    expect(visto.line).toContain("cbWindow=24h (env)");
    expect(visto.line).toContain("cbCaixa=3h (env)");
  });

  test("sem o ambiente, o mesmo arranque vem do config e a bootLine di-lo", () => {
    const r = arranque({ CB_FLIPS: undefined, CB_WINDOW_H: undefined, CB_CAIXA_H: undefined });
    expect(r.code).toBe(0);
    const visto = JSON.parse(r.out);
    expect(visto).toMatchObject({ flips: 4, windowMs: 12 * H, caixaMs: 6 * H, source: "config" });
    expect(visto.line).toContain("cbFlips=4 (config)");
    expect(visto.line).toContain("cbWindow=12h (config)");
    expect(visto.line).toContain("cbCaixa=6h (config)");
  });
});

describe("CB configuravel (issue #37) · a origem e impressa", () => {
  test("a bootLine marca (config) nos tres quando o ambiente nao manda", () => {
    const l = bootLine(run, "BTC");
    expect(l).toContain("cbFlips=4 (config)");
    expect(l).toContain("cbWindow=12h (config)");
    expect(l).toContain("cbCaixa=6h (config)");
    expect(cbKnobs.flips.source).toBe("config");
  });

  test("o mesmo valor pelo ambiente continua a ser distinguivel: (env) contra (config)", () => {
    const r = arranque({ CB_FLIPS: "4" }); // o mesmo 4, mas vindo do ambiente
    expect(r.code).toBe(0);
    const visto = JSON.parse(r.out);
    expect(visto.flips).toBe(4);
    expect(visto.line).toContain("cbFlips=4 (env)");
  });
});

describe("CB configuravel (issue #37) · valor fora de banda e recusado", () => {
  test("zero, negativo, nao-inteiro, nao-numero: tudo recusado", () => {
    for (const mau of ["0", "-1", "-12", "3.5", "abc", "", "  ", "1e3", "0x4"]) {
      expect(() => resolveCbKnobs({ CB_FLIPS: mau })).toThrow(/CB_FLIPS=.*fora de banda/);
    }
  });

  test("absurdo e recusado com a razao: mais viradas do que horas na janela nunca arma", () => {
    expect(() => resolveCbKnobs({ CB_FLIPS: "13" })).toThrow(/inteiro entre 1 e 12 \(as horas de CB_WINDOW_H/);
    expect(() => resolveCbKnobs({ CB_FLIPS: "999" })).toThrow(/fora de banda/);
    // Com a janela maior, o mesmo limiar passa a caber.
    expect(resolveCbKnobs({ CB_FLIPS: "13", CB_WINDOW_H: "24" }).flips.value).toBe(13);
  });

  test("a janela e a caixa tambem tem banda: 1 h ate um ano", () => {
    for (const mau of ["0", "-3", "1.5", "abc"]) {
      expect(() => resolveCbKnobs({ CB_WINDOW_H: mau })).toThrow(/CB_WINDOW_H=.*fora de banda/);
      expect(() => resolveCbKnobs({ CB_CAIXA_H: mau })).toThrow(/CB_CAIXA_H=.*fora de banda/);
    }
    expect(() => resolveCbKnobs({ CB_WINDOW_H: String(CB_BAND_MAX_H + 1) })).toThrow(/fora de banda/);
    expect(() => resolveCbKnobs({ CB_CAIXA_H: "8761" })).toThrow(/fora de banda/);
  });

  test("o porteiro recusa no arranque: o processo nao sobe com o CB fora de banda", () => {
    const r = arranque({ CB_FLIPS: "0" });
    expect(r.code).not.toBe(0);
    expect(r.out).toBe("");
    expect(r.err).toContain('CB_FLIPS="0" fora de banda');
  });
});
