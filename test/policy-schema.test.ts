import { expect, test } from "bun:test";
import { askQuestions, lintPolicyText, loadPolicyFile, parsePolicy, placeholdersIn, validatePolicy } from "../src/policy/load";

const REAL = "./policy/jev_questions.json";
const policy = loadPolicyFile(REAL);

function clone(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(policy)) as Record<string, unknown>;
}

function withQuestions(mutate: (q: Record<string, any>) => void): Record<string, unknown> {
  const p = clone();
  mutate(p.questions as Record<string, any>);
  return p;
}

test("o policy file do repo passa a validacao", () => {
  const checked = validatePolicy(policy);
  expect(checked.ok).toBe(true);
  expect(policy.version).toBeGreaterThanOrEqual(1);
  expect(Object.keys(policy.questions).sort()).toEqual(["act", "too_hostile"]);
});

test("proposta que apaga hold e recusada", () => {
  const p = withQuestions((q) => {
    delete (q.act.criteria as Record<string, unknown>).hold;
  });
  const checked = validatePolicy(p);
  expect(checked.ok).toBe(false);
  if (!checked.ok) expect(checked.issues.map((i) => i.problem).join(" ")).toContain("hold");
});

test("proposta com tamanho, preco e alavancagem no texto e recusada", () => {
  const p = withQuestions((q) => {
    q.act.criteria.buy = "buy 0.5 BTC at 10x";
  });
  const checked = validatePolicy(p);
  expect(checked.ok).toBe(false);
  if (!checked.ok) expect(checked.issues.length).toBeGreaterThan(0);
});

test("texto com limiar numerico, percentagem ou bps e recusado", () => {
  expect(lintPolicyText({ a: "only above 0.80 confidence" }).length).toBeGreaterThan(0);
  expect(lintPolicyText({ a: "spread below 40 bps" }).length).toBeGreaterThan(0);
  expect(lintPolicyText({ a: "size 40 usd" }).length).toBeGreaterThan(0);
});

test("texto sem numeros passa, inclusive com nomes de bucket", () => {
  expect(lintPolicyText({ a: "Maker edge to lift or cover a short without chasing a violent tape." })).toEqual([]);
  expect(lintPolicyText({ a: "bot_war plus violent tape, or funding extreme against the would-be add." })).toEqual([]);
});

test("placeholder fora da lista e recusado (tickMs nao entra)", () => {
  const p = withQuestions((q) => {
    q.act.instructions.timing = "one decision per {{tickMs}}";
  });
  const checked = validatePolicy(p);
  expect(checked.ok).toBe(false);
  if (!checked.ok) expect(checked.issues.map((i) => i.problem).join(" ")).toContain("tickMs");
  expect(placeholdersIn(p)).toContain("tickMs");
});

test("pergunta a mais ou tipo trocado e desvio de schema", () => {
  const extra = withQuestions((q) => {
    q.confidence = { type: "score", instructions: "x", criteria: ["a", "b"] };
  });
  expect(validatePolicy(extra).ok).toBe(false);

  const swapped = withQuestions((q) => {
    q.act.type = "noul";
  });
  expect(validatePolicy(swapped).ok).toBe(false);
});

test("JSON ilegivel falha alto em vez de seguir com policy vazio", () => {
  expect(() => parsePolicy("{ nao e json")).toThrow("ilegivel");
  expect(() => parsePolicy("{}")).toThrow("recusada");
});

test("as perguntas renderizadas trocam os placeholders e nao deixam chaves", () => {
  const q = askQuestions(policy, { asset: "SOL", stance: "long" });
  const text = JSON.stringify(q);
  expect(text).not.toContain("{{");
  expect(text).toContain("SOL");
  expect(text).toContain("long");
  expect(q.act.type).toBe("choice");
  expect(q.too_hostile.type).toBe("noul");
});

test("o placeholders de estance nao carrega tamanho nem decimal", () => {
  const q = askQuestions(policy, { asset: "SOL", stance: "long" });
  expect(JSON.stringify(q.too_hostile)).toContain("inventory is long");
  expect(JSON.stringify(q.too_hostile)).not.toMatch(/inventory is long \d/);
});
