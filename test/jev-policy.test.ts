import { expect, test } from "bun:test";
import { JevPolicy, readChoiceAnswer, readNoulAnswer, withDeadline, type AskJev } from "../src/model";
import { loadPolicyFile } from "../src/policy/load";
import { toSnapshot, type SnapshotInput } from "../src/risk/buckets";
import { isFrozen, riskIntent, standsDown } from "../src/risk/intent";
import type { Verdict } from "../src/risk/types";

/**
 * Prova, SEM rede, o que o passo do dry-run com `POLICY=jev` iria provar do lado
 * do parse: resposta boa vira veredicto, desvio de schema e falha viram
 * `raw_ok=false`, e o gate congela. O que fica por provar com chave e so a forma
 * real da resposta do vendor (spec 9.2).
 */

const policy = loadPolicyFile("./policy/jev_questions.json");
const STATE = "normal deep two_way flat flat pay_neutral mid";
const CID = "20260923T123015Z-SOL";

/** Forma exacta do SDK 0.6.0: ChoiceResponse {choice, confidence, probabilities} + NoulResponse {noul}. */
const good = (): Awaited<ReturnType<AskJev>> => ({
  answers: {
    act: { type: "choice", choice: "buy", confidence: 0.86, probabilities: { buy: 0.7, sell: 0.1, hold: 0.2 } },
    too_hostile: { type: "noul", noul: 0.11 },
  },
  model: "jev-1.13.0",
  tokens: 120,
});

const scripted = (fn: () => Awaited<ReturnType<AskJev>> | never): AskJev => async () => fn();

const snap = () => {
  const base: SnapshotInput = {
    ts: Date.UTC(2026, 8, 23, 12, 30, 15),
    sleeve: "SOL",
    book: { bid: 187.2, ask: 187.28, mid: 187.24, spreadBps: 4.3, depthBps: { "10": { bid: 120.4, ask: 38.1 } } },
    bookAgeMs: 42,
    returnsBps: { last1: 2, last5: 3, last20: 1 },
    volBps: 6,
    prints: { count: 20, buySz: 60, sellSz: 55, cvdSz: 5 },
    position: { side: "flat", size: 0 },
    account: { equityUsd: 200, unrealizedUsd: 0, leverage: 1 },
    fundingBps: 0.02,
    mark: 187.21,
    bankrollUsd: 200,
    maxLeverage: 40,
  };
  return toSnapshot(base);
};

const gate = (v: Verdict) => riskIntent({ cycleId: CID, sleeve: "SOL", verdict: v, snap: snap() });

test("resposta boa: veredicto completo e o gate deixa passar", async () => {
  const v = await new JevPolicy(policy, scripted(good)).decide(STATE, CID);
  expect(v).toMatchObject({ act: "buy", act_conf: 0.86, too_hostile: 0.11, raw_ok: true, model: "jev-1.13.0" });
  expect(v.act_probs).toEqual({ buy: 0.7, sell: 0.1, hold: 0.2 });
  expect(v.input_tokens).toBe(120);
  const i = gate(v);
  expect(i.side).toBe("buy");
  expect(isFrozen(i)).toBe(false);
});

test("hold do Jev passa pelo gate como stand-down, nao como congelamento", async () => {
  const hold = good();
  hold.answers.act = { type: "choice", choice: "hold", confidence: 0.9, probabilities: { buy: 0.05, sell: 0.05, hold: 0.9 } };
  const v = await new JevPolicy(policy, scripted(() => hold)).decide(STATE, CID);
  const i = gate(v);
  expect(i.reason).toBe("jev_hold");
  expect(standsDown(i)).toBe(true);
  expect(isFrozen(i)).toBe(false);
});

test("probabilidades que nao somam 1 viram raw_ok=false", async () => {
  const bad = good();
  bad.answers.act = { type: "choice", choice: "buy", confidence: 0.9, probabilities: { buy: 0.9, sell: 0.9, hold: 0.9 } };
  const v = await new JevPolicy(policy, scripted(() => bad)).decide(STATE, CID);
  expect(v.raw_ok).toBe(false);
  expect(v.note).toBe("parse");
  expect(isFrozen(gate(v))).toBe(true);
});

test("choice fora de buy|sell|hold e recusado", async () => {
  const bad = good();
  bad.answers.act = { type: "choice", choice: "long", confidence: 0.9, probabilities: { buy: 0.1, sell: 0.1, hold: 0.8 } };
  expect((await new JevPolicy(policy, scripted(() => bad)).decide(STATE, CID)).raw_ok).toBe(false);
});

test("noul nulo, em texto ou fora de [0,1] congela em vez de passar", async () => {
  // Fail-open aqui seria ler um campo ausente como "livro nao hostil".
  for (const noul of [1.4, -0.2, "0.1", null, undefined, true]) {
    const bad = good();
    bad.answers.too_hostile = { type: "noul", noul };
    const v = await new JevPolicy(policy, scripted(() => bad)).decide(STATE, CID);
    expect(v.raw_ok, `noul=${JSON.stringify(noul)}`).toBe(false);
    expect(isFrozen(gate(v)), `noul=${JSON.stringify(noul)} devia congelar`).toBe(true);
  }
});

test("probabilidade em texto ou ausente tambem congela", async () => {
  const emTexto = good();
  emTexto.answers.act = { type: "choice", choice: "buy", confidence: 0.9, probabilities: { buy: "0.7", sell: 0.1, hold: 0.2 } };
  expect((await new JevPolicy(policy, scripted(() => emTexto)).decide(STATE, CID)).raw_ok).toBe(false);

  const ausente = good();
  ausente.answers.act = { type: "choice", choice: "buy", confidence: 0.9, probabilities: { buy: 0.7, sell: 0.3 } };
  expect((await new JevPolicy(policy, scripted(() => ausente)).decide(STATE, CID)).raw_ok).toBe(false);
});

test("falta de confidence (campo do SDK) vira raw_ok=false", async () => {
  const bad = good();
  bad.answers.act = { type: "choice", choice: "buy", probabilities: { buy: 0.7, sell: 0.1, hold: 0.2 } };
  const v = await new JevPolicy(policy, scripted(() => bad)).decide(STATE, CID);
  expect(v.raw_ok).toBe(false);
  expect(isFrozen(gate(v))).toBe(true);
});

test("a API estoura por timeout: nota timeout e o gate congela (nao cancela)", async () => {
  const asks: AskJev = async () => {
    throw new Error("jev timeout 800ms");
  };
  const v = await new JevPolicy(policy, asks).decide(STATE, CID);
  expect(v.raw_ok).toBe(false);
  expect(v.note).toBe("timeout");
  const i = gate(v);
  expect(i.reason).toBe("frozen_timeout");
  expect(isFrozen(i)).toBe(true);
  expect(standsDown(i)).toBe(false);
});

test("erro de transporte tambem congela, com a nota propria", async () => {
  const asks: AskJev = async () => {
    throw new Error("fetch failed");
  };
  const v = await new JevPolicy(policy, asks).decide(STATE, CID);
  expect(v.note).toBe("transport");
  expect(isFrozen(gate(v))).toBe(true);
});

test("withDeadline rejeita a promessa que passa do limite e deixa passar a que chega", async () => {
  const never = new Promise<string>(() => {});
  await expect(withDeadline(never, 30)).rejects.toThrow(/timeout/);
  await expect(withDeadline(Promise.resolve("ok"), 300)).resolves.toBe("ok");
});

test("os parsers aceitam a forma do SDK e recusam desvio de tipo", () => {
  expect(readChoiceAnswer({ type: "choice", choice: "SELL", confidence: 0.5, probabilities: { buy: 0.25, sell: 0.5, hold: 0.25 } }))
    .toMatchObject({ act: "sell", conf: 0.5 });
  expect(readChoiceAnswer({ type: "noul", noul: 0.5 })).toBe(null);
  expect(readChoiceAnswer(undefined)).toBe(null);
  expect(readNoulAnswer({ type: "noul", noul: 0 })).toBe(0);
  expect(readNoulAnswer({ type: "choice", choice: "buy" })).toBe(null);
});
