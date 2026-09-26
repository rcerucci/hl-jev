/**
 * #37 — o que os resolvedores puros do `test/cb-config.test.ts` nao podem provar: que o ambiente
 * **real** de um processo novo chega ao `config` (que se le uma vez, no import) e a bootLine. Cada
 * teste corre um `bun -e` com o `CB_*` posto no ambiente do filho: nem o ambiente da maquina nem o
 * `.env` do clone entram na conta.
 */
import { describe, expect, test } from "bun:test";

const H = 3_600_000;

const cfgUrl = new URL("../src/config.ts", import.meta.url).href;
const gateUrl = new URL("../src/gate.ts", import.meta.url).href;

/** O arranque, na ordem do motor: resolve a corrida, passa o porteiro, escreve a bootLine. */
const probe = `
(async () => {
  const { config } = await import(${JSON.stringify(cfgUrl)});
  const { assertAlphaRun, bootLine } = await import(${JSON.stringify(gateUrl)});
  const run = {
    policy: "sigma",
    coins: ["BTC"],
    dryRun: true,
    hlTestnet: true,
    hasSigner: false,
    leverage: 1,
    bankrollUsd: 200,
    maxLiveEquityUsd: config.maxLiveEquityUsd,
  };
  assertAlphaRun(run);
  console.log(JSON.stringify({
    flips: config.sigma.cbFlips,
    source: config.sigma.cbFlipsSource,
    windowMs: config.sigma.cbWindowMs,
    caixaMs: config.sigma.cbCaixaMs,
    line: bootLine(run, "BTC"),
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

const semCb = { CB_FLIPS: undefined, CB_WINDOW_H: undefined, CB_CAIXA_H: undefined };

describe("#37 · o circuito de chop pelo ambiente, num processo novo", () => {
  test("sem o ambiente, o default e o do config e a bootLine di-lo", () => {
    const r = arranque(semCb);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({
      flips: 4,
      source: "config",
      windowMs: 12 * H,
      caixaMs: 6 * H,
    });
    expect(JSON.parse(r.out).line).toContain("cbFlips=4 (config)");
  });

  test("com o CB_* no ambiente, o config segue-o e a bootLine diz (env)", () => {
    const r = arranque({ CB_FLIPS: "7", CB_WINDOW_H: "24", CB_CAIXA_H: "3" });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({
      flips: 7,
      source: "env",
      windowMs: 24 * H,
      caixaMs: 3 * H,
    });
    expect(JSON.parse(r.out).line).toContain("cbFlips=7 (env)");
  });

  test("o mesmo 4 pelo ambiente continua distinguivel do 4 do config", () => {
    const r = arranque({ ...semCb, CB_FLIPS: "4" });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ flips: 4, source: "env" });
    expect(JSON.parse(r.out).line).toContain("cbFlips=4 (env)");
  });

  test("fora de banda o porteiro mata o arranque, sem linha nenhuma", () => {
    for (const mau of ["0", "-1", "99", "abc"]) {
      const r = arranque({ ...semCb, CB_FLIPS: mau });
      expect(r.code).not.toBe(0);
      expect(r.out).toBe("");
      expect(r.err).toContain("banda");
    }
  });
});
