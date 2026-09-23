/**
 * A caixa POLICY, primeira metade: o ficheiro versionado e o seu carregador.
 *
 * A LLM da noite (Fase D) so pode reescrever `instructions` e `criteria`. Este
 * modulo e o portao: valida o schema e **recusa** deriva antes de qualquer coisa
 * chegar ao Jev ou ao humano. O mesmo validador serve o `accept` da noite.
 *
 * D4: `instructions` e objecto (como o repo ja manda) e os placeholders sao
 * **nao numericos** — so `asset` e `stance`. `tickMs`, rungs de alavancagem e
 * decimais estao proibidos, e um placeholder desconhecido e recusado no load.
 */
import { readFileSync } from "node:fs";
import { choice, noul, type EntryType, type Questions } from "@typesafe-ai/sdk";

export interface PolicyFile {
  version: number;
  updated_at: string;
  source: string;
  questions: Record<string, PolicyQuestion>;
}

export interface PolicyQuestion {
  type: "choice" | "noul";
  instructions: EntryType;
  criteria: EntryType | { true?: EntryType; false?: EntryType } | Record<string, EntryType>;
}

export const ALLOWED_PLACEHOLDERS = ["asset", "stance"] as const;
const PLACEHOLDER = /\{\{([a-zA-Z_]+)\}\}/g;

/** Numeros que nunca podem aparecer no texto que o Jev le como criterio. */
const UNIT_NUMBER = /\d+[.,]?\d*\s*(?:x|%|usd|usdc|dollars?|bps)\b|\d+[.,]?\d*\s*(?:btc|eth|sol|doge|bnb)\b/i;
/** D4: zero digitos no texto que a noite reescreve. Cobre limiares soltos. */
const ANY_NUMBER = /\d/;

export interface PolicyIssue {
  path: string;
  problem: string;
}

/** Varre todo o texto que a noite pode tocar e devolve os problemas encontrados. */
export function lintPolicyText(raw: unknown, path = "questions"): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  const walk = (node: unknown, where: string) => {
    if (typeof node === "string") {
      if (UNIT_NUMBER.test(node)) {
        issues.push({ path: where, problem: `numero com unidade no texto: ${JSON.stringify(node)}` });
      } else if (ANY_NUMBER.test(node)) {
        issues.push({ path: where, problem: `numero no texto que a noite reescreve: ${JSON.stringify(node)}` });
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${where}[${i}]`));
      return;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) walk(v, `${where}.${k}`);
    }
  };
  walk(raw, path);
  return issues;
}

/** Placeholders usados no texto, para recusar antes de mandar ao Jev. */
export function placeholdersIn(raw: unknown): string[] {
  const found = new Set<string>();
  const walk = (node: unknown) => {
    if (typeof node === "string") {
      for (const m of node.matchAll(PLACEHOLDER)) found.add(m[1]!);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") Object.values(node).forEach(walk);
  };
  walk(raw);
  return [...found];
}

/**
 * Valida o ficheiro inteiro. Regras da v1 (spec 3.3 / 7.3):
 * - `act` e um `choice` com buy, sell e hold (apagar `hold` e deriva);
 * - `too_hostile` e um `noul` com true e false descritos;
 * - `type` nao muda, nao nascem perguntas novas;
 * - nenhum placeholder fora de ALLOWED_PLACEHOLDERS;
 * - nenhum numero em instructions/criteria.
 */
export function validatePolicy(raw: unknown): { ok: true; policy: PolicyFile } | { ok: false; issues: PolicyIssue[] } {
  const issues: PolicyIssue[] = [];
  const bad = (path: string, problem: string) => issues.push({ path, problem });

  if (!raw || typeof raw !== "object") return { ok: false, issues: [{ path: "$", problem: "policy nao e um objecto" }] };
  const p = raw as Partial<PolicyFile>;
  if (typeof p.version !== "number" || p.version < 1) bad("version", "version tem de ser inteiro >= 1");
  if (typeof p.updated_at !== "string") bad("updated_at", "updated_at tem de ser string ISO");
  if (typeof p.source !== "string") bad("source", "source tem de ser string");

  const questions = p.questions;
  if (!questions || typeof questions !== "object") return { ok: false, issues: [...issues, { path: "questions", problem: "questions ausente" }] };

  const names = Object.keys(questions).sort();
  if (names.join(",") !== "act,too_hostile") {
    bad("questions", `a v1 tem exactamente act e too_hostile; veio ${names.join(",") || "(vazio)"}`);
  }

  const act = questions.act as PolicyQuestion | undefined;
  if (!act || act.type !== "choice") bad("questions.act.type", "act tem de ser choice");
  else {
    const keys = Object.keys((act.criteria ?? {}) as Record<string, unknown>).sort();
    if (!keys.includes("hold")) bad("questions.act.criteria", "act perdeu a opcao hold");
    for (const k of ["buy", "sell", "hold"]) {
      if (!keys.includes(k)) bad("questions.act.criteria", `act sem a opcao ${k}`);
    }
    if (keys.length !== 3) bad("questions.act.criteria", `act com opcoes a mais: ${keys.join(",")}`);
  }

  const hostile = questions.too_hostile as PolicyQuestion | undefined;
  if (!hostile || hostile.type !== "noul") bad("questions.too_hostile.type", "too_hostile tem de ser noul");
  else {
    const c = (hostile.criteria ?? {}) as Record<string, unknown>;
    for (const k of ["true", "false"]) {
      if (!(k in c)) bad("questions.too_hostile.criteria", `too_hostile sem a descricao ${k}`);
    }
  }

  issues.push(...lintPolicyText(questions));
  for (const name of placeholdersIn(questions)) {
    if (!(ALLOWED_PLACEHOLDERS as readonly string[]).includes(name)) {
      bad("questions", `placeholder nao permitido: {{${name}}} (so ${ALLOWED_PLACEHOLDERS.join(", ")})`);
    }
  }

  if (issues.length) return { ok: false, issues };
  return { ok: true, policy: p as PolicyFile };
}

export function parsePolicy(text: string): PolicyFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`policy ilegivel: ${(e as Error).message}`);
  }
  const checked = validatePolicy(raw);
  if (!checked.ok) {
    throw new Error(`policy recusada: ${checked.issues.map((i) => `${i.path}: ${i.problem}`).join("; ")}`);
  }
  return checked.policy;
}

export function loadPolicyFile(path = "./policy/jev_questions.json"): PolicyFile {
  return parsePolicy(readFileSync(path, "utf8"));
}

/** Substitui os placeholders permitidos, recursivamente, sem tocar em numeros. */
export function renderEntry(entry: EntryType, vars: { asset: string; stance: string }): EntryType {
  if (typeof entry === "string") {
    return entry.replace(PLACEHOLDER, (_, name: string) => (name === "asset" ? vars.asset : vars.stance));
  }
  if (Array.isArray(entry)) return entry.map((v) => renderEntry(v as unknown as EntryType, vars)) as EntryType;
  if (entry && typeof entry === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(entry)) out[k] = renderEntry(v as unknown as EntryType, vars);
    return out as EntryType;
  }
  return entry;
}

/** As duas perguntas da v1, prontas para o `systemOne`. */
export function askQuestions(policy: PolicyFile, vars: { asset: string; stance: string }): Questions {
  const act = policy.questions.act!;
  const hostile = policy.questions.too_hostile!;
  return {
    act: choice(renderEntry(act.instructions, vars), renderEntry(act.criteria, vars) as Record<string, EntryType>),
    too_hostile: noul(renderEntry(hostile.instructions, vars), renderEntry(hostile.criteria, vars) as { true?: EntryType; false?: EntryType }),
  };
}
