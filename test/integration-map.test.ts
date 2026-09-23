/**
 * Alarme do mapa da fusao (INTEGRATION.md).
 *
 * Nao confere numero de linha: confere os INVARIANTES que a fusao nao pode
 * quebrar (spec sec. 2.2, 5.1, 11). Fato preso a linha vive no INTEGRATION.md
 * ancorado ao SHA e le-se com `git show <sha>:<arquivo>`.
 *
 * A raiz do repo entra por argumento para o alarme poder ser provado contra
 * uma copia corrompida (o negativo):
 *   FUSAO_REPO=/caminho/da/copia bun test test/integration-map.test.ts
 *
 * Se um invariante for legitimamente alterado, altera-se INTEGRATION.md e este
 * ficheiro no MESMO commit - nunca se afrouxa a regra para o teste passar.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.env.FUSAO_REPO ?? join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const srcFiles = () => readdirSync(join(root, "src")).filter((f) => f.endsWith(".ts"));
const srcText = () => srcFiles().map((f) => [f, read(`src/${f}`)] as const);
const hits = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("o executor nao foi reimplementado (spec 11)", () => {
  test("market.send mantem a assinatura", () => {
    expect(read("src/market.ts")).toContain(
      "async send(side: Side, sizeSz: number, book: Book, cancel: number[], reduceOnly = false, taker = false): Promise<Quote>",
    );
  });

  test("cancelResting mantem a assinatura", () => {
    expect(read("src/market.ts")).toContain("async cancelResting(): Promise<number[]>");
  });

  test("setLeverage mantem a assinatura e continua a ser chamado", () => {
    expect(read("src/market.ts")).toContain("async setLeverage(raw: number): Promise<number>");
    expect(read("src/trader.ts")).toContain("await this.market.setLeverage(");
  });

  test("existe um unico sitio que chama market.send, e e o trader", () => {
    const callers = srcText().filter(([, t]) => t.includes("this.market.send(")).map(([f]) => f);
    expect(callers).toEqual(["trader.ts"]);
    expect(hits(read("src/trader.ts"), "this.market.send(")).toBe(1);
  });

  test("o trader continua a passar por planQuote e pelos dois desfechos", () => {
    const t = read("src/trader.ts");
    expect(t).toContain("planQuote({");
    expect(t).toContain("enqueueQuote");
    expect(t).toContain("enqueueStandDown");
  });

  test("plan.ts mantem open=ALO e close=IOC reduce-only", () => {
    const p = read("src/plan.ts");
    expect(p).toContain("reduceOnly: false, taker: false");
    expect(p).toContain("reduceOnly: true, taker: true");
  });

  test("os unicos TIF sao Alo e Ioc (spec 5.2)", () => {
    const market = read("src/market.ts");
    expect(market).toContain('tif: "Alo" | "Ioc"');
    expect(market).toContain('"Alo"');
    expect(market).toContain('"Ioc"');
    for (const [f, t] of srcText()) {
      expect(t, `${f} introduziu um TIF fora de Alo/Ioc`).not.toMatch(/"Gtc"|"Market"|type: "market"/);
    }
  });

  test("nao entrou um segundo cliente Hyperliquid", () => {
    const deps = JSON.parse(read("package.json")).dependencies ?? {};
    expect(Object.keys(deps)).toContain("@nktkas/hyperliquid");
    const suspicious = Object.keys(deps).filter((d) => /hyperliquid|hl-sdk/i.test(d) && d !== "@nktkas/hyperliquid");
    expect(suspicious).toEqual([]);
  });
});

describe("defaults e seguranca (spec 2.2)", () => {
  test("testnet e o default e ha cap explicito para mainnet", () => {
    const c = read("src/config.ts");
    expect(c).toContain('env("HL_TESTNET", "true")');
    expect(c).toContain('env("MODEL", "mock")');
    expect(c).toContain('env("TICK_MS", "2000")');
    expect(c).toContain('env("QUOTE_USD", "40")');
  });

  /** Dispensas exigem motivo escrito, e o teste imprime quem dispensou. */
  const DISPENSADOS: { file: string; trecho: string; motivo: string }[] = [];
  const isLog = /console\.(log|error|warn)\(/;
  // Dispara no VALOR registado, nao na palavra: `!spec.privateKey ? "DRY RUN" : market.address`
  // usa a chave como booleano e registra o endereco publico - nao e fuga. Por isso a regra exige
  // que a interpelacao TERMINE na credencial, ou que ela venha como argumento.
  // Limite declarado: so olha a linha do proprio console.*; interpolacao partida em
  // varias linhas escapa a esta regra.
  const CHAVE = String.raw`(?:privateKey|apiKey|mnemonic|secretKey)`;
  const ENV_CHAVE = String.raw`process\.env\.[A-Z0-9_]*(?:KEY|SECRET|WALLETS_JSON)`;
  const valorRegistado = new RegExp(
    String.raw`\$\{[^{}]*\b` + CHAVE + String.raw`\s*\}` + // ${spec.privateKey}
      String.raw`|\$\{\s*` + ENV_CHAVE + String.raw`\s*\}` + // ${process.env.TYPESAFE_API_KEY}
      String.raw`|[,+(]\s*(?:` + ENV_CHAVE + "|" + String.raw`(?:config|sleeve|spec|this|market)\.` + CHAVE + String.raw`)\s*[,)+]`,
  );

  test("nenhuma chave aparece em linha de log", () => {
    const usados: string[] = [];
    for (const [f, t] of srcText()) {
      for (const line of t.split("\n")) {
        if (!isLog.test(line) || !valorRegistado.test(line)) continue;
        const d = DISPENSADOS.find((x) => x.file === f && line.includes(x.trecho));
        if (d) {
          usados.push(`${f} (${d.motivo})`);
          continue;
        }
        expect(false, `${f} registou credencial: ${line.trim()}`).toBe(true);
      }
    }
    console.log(`  dispensados: ${usados.length ? usados.join(" | ") : "nenhum"}`);
  });

  test(".wallets.json continua fora do git e o exemplo so tem marcadores", () => {
    expect(read(".gitignore")).toContain(".wallets.json");
    const example = JSON.parse(read(".wallets.example.json"));
    for (const s of example.sleeves ?? []) {
      expect(String(s.privateKey), "o exemplo carrega uma chave que parece real").toMatch(/^0xYOUR_/);
    }
  });
});

describe("contrato de fio com o desk (nao quebrar em silencio)", () => {
  test("as duas copias dos tipos de fio existem", () => {
    expect(read("src/types.ts").length).toBeGreaterThan(0);
    expect(read("web/src/lib/bot-types.ts").length).toBeGreaterThan(0);
  });
});

describe("perguntas e veredicto de hoje (baseline pinado ao SHA)", () => {
  test("o cliente Jev e o caminho unico para o modelo", () => {
    const m = read("src/model.ts");
    expect(m).toContain("export class JevModel");
    expect(m).toContain("systemOne(");
    expect(m).toContain("export class MockModel");
    expect(m).toContain("export function jevQuestions");
    expect(m).toContain("export function marketFacing");
    expect(m).toContain("export function decideFromJevAnswers");
    expect(m).toContain("export const createModel");
  });

  test("o controlo dumb tem de consumir os adjectivos, nao os numeros", () => {
    // Guarda contra o erro previsto na secao F5 do plano: o MockModel decide a
    // partir de returnsBps/bookImbalance/cvd. O controle da secao 9.4 da spec
    // tem de receber a mesma string de 12 palavras que o Jev recebe.
    const buckets = () => {
      try {
        return read("src/risk/buckets.ts");
      } catch {
        return null;
      }
    };
    const t = buckets();
    if (t !== null) expect(t).not.toMatch(/returnsBps|bookImbalance|cvdSz|fundingBps/);
  });
});
