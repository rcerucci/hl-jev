import { experimental_evaluate as evaluate } from "ai";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { Questions } from "@typesafe-ai/sdk";
import { assertJevCredentials, config } from "./config";
import { leverageRungs, liveIntent, parseLeverage, quoteAction, type Bias, type Intent } from "./plan";
import { DumbPolicy } from "./policy/dumb";
import { NumericPolicy } from "./policy/numeric";
import { StancePolicy } from "./policy/stance";
import { askQuestions, loadPolicyFile, type PolicyFile } from "./policy/load";
import { stanceFromState } from "./risk/buckets";
import type { Act, Policy, Verdict } from "./risk/types";
import type { Action, Side } from "./types";

/** What the model sees. Compact, relative, human-readable. */
export interface TradeState {
  coin: string;
  market: string;
  tick: number;
  tickMs: number;
  mid: number;
  spreadBps: number;
  bookImbalance: number;
  /** Cumulative resting size within 10/25/50 bps of mid, per side. */
  depth: { [band: string]: { bid: number; ask: number } };
  /** Top 5 levels each side, best first, as "price x size". */
  book: { bids: string[]; asks: string[] };
  returnsBps: { last1: number; last5: number; last20: number; last100: number };
  recentMids: string;
  /** Taker prints in the lookback window. cvdSz = taker buy size minus taker sell size. */
  trades: { count: number; buySz: number; sellSz: number; cvdSz: number; vwap: number | null; lastPrice: number | null; lastSide: Side | null };
  recentTrades: string[];
  position: {
    coin: string;
    side: "long" | "short" | "flat";
    size: number;
    notionalUsd: number;
    entry: number | null;
    leverage: number | null;
    liquidationPx: number | null;
    distanceBps: number | null;
    unrealizedUsd: number;
  };
  indicators: {
    sma20: number | null;
    sma50: number | null;
    ema20: number | null;
    midVsSma20Bps: number | null;
    midVsSma50Bps: number | null;
    rsi14: number | null;
    vol20Bps: number | null;
    high20: number | null;
    low20: number | null;
    rangePos20: number | null;
  };
  asset: {
    markPx: number | null;
    oraclePx: number | null;
    fundingBps: number | null;
    premiumBps: number | null;
    openInterest: number | null;
    dayNtlVlmUsd: number | null;
    dayChangeBps: number | null;
    maxLeverage: number;
  };
  maxLeverage: number;
}

export interface ModelDecision {
  action: Action;
  intent: Intent;
  bias: Bias;
  leverage: number;
  probabilities: {
    buy: number;
    sell: number;
    hold: number;
    long: number;
    short: number;
    open: number;
    close: number;
  };
  upIn10: number;
  latencyMs: number;
  inputTokens: number;
  /** Caminho da fusao: as doze palavras que a POLICY viu, e o veredicto cru. */
  state12?: string;
  act?: Action;
  act_conf?: number;
  too_hostile?: number;
  /** Porque o gate travou (hostile, low_conf, frozen_*, ...). So no caminho da fusao. */
  reason?: string;
}

export interface Model {
  readonly name: string;
  decide(state: TradeState): Promise<ModelDecision>;
}

/** Book, tape, and the open position. Wallet fills and lifetime PnL stay off this object. */
export function marketFacing(state: TradeState) {
  const pos = state.position;
  return {
    coin: state.coin,
    market: state.market,
    tick: state.tick,
    tickMs: state.tickMs,
    mid: state.mid,
    spreadBps: state.spreadBps,
    bookImbalance: state.bookImbalance,
    depth: state.depth,
    book: state.book,
    returnsBps: state.returnsBps,
    recentMids: state.recentMids,
    trades: state.trades,
    recentTrades: state.recentTrades,
    position: {
      coin: pos.coin,
      side: pos.side,
      size: pos.size,
      notionalUsd: pos.notionalUsd,
      entry: pos.entry,
      leverage: pos.leverage,
      liquidationPx: pos.liquidationPx,
      distanceBps: pos.distanceBps,
      ...(pos.side === "flat" ? {} : { unrealizedUsd: pos.unrealizedUsd }),
    },
    indicators: state.indicators,
    asset: state.asset,
    maxLeverage: state.maxLeverage,
  };
}

/** Labels and live fields only. No advice about when to pick an action. */
export function jevQuestions(state: TradeState) {
  const asset = state.coin;
  const pos = state.position;
  const stance = pos.side === "flat"
    ? `flat ${asset}`
    : `${pos.side} ${pos.size} ${asset} @ ${pos.entry ?? "?"}`;
  const levNow = pos.leverage != null ? `${pos.leverage}x` : "unset";
  const rungs = leverageRungs(state.maxLeverage);
  const levCriteria: Record<string, string> = {};
  for (const n of rungs) {
    levCriteria[String(n)] = `${n}x`;
  }
  const ctx = `${asset} ${state.market}. position has side/size/entry. indicators are 1m sma/ema/rsi/vol. asset is mark/oracle/funding/oi. trades and book are the tape.`;
  const bias = {
    type: "choice",
    instructions: {
      question: `long or short ${asset}?`,
      goal: `${state.market}`,
      timing: `tickMs=${state.tickMs}. position=${stance}.`,
      inputs: ctx,
    },
    criteria: {
      long: "long",
      short: "short",
    },
  };
  const leverage = {
    type: "choice",
    instructions: {
      question: `cross leverage for ${asset}?`,
      goal: `current ${levNow}. max ${state.maxLeverage}x.`,
      timing: `rungs ${rungs.join(" ")}`,
      inputs: ctx,
    },
    criteria: levCriteria,
  };
  if (pos.side === "flat") {
    return {
      bias,
      intent: {
        type: "choice",
        instructions: {
          question: `open or hold ${asset}?`,
          goal: `position=${stance}.`,
          timing: `tickMs=${state.tickMs}`,
          inputs: ctx,
        },
        criteria: {
          open: "open",
          hold: "hold",
        },
      },
      leverage,
    };
  }
  return {
    bias,
    intent: {
      type: "choice",
      instructions: {
        question: `open, close, or hold ${asset}?`,
        goal: `position=${stance}.`,
        timing: `tickMs=${state.tickMs}`,
        inputs: ctx,
      },
      criteria: {
        open: "open",
        close: "close",
        hold: "hold",
      },
    },
    leverage,
  };
}

interface Packed {
  intent: Intent;
  bias: Bias;
  leverage: number;
  longP: number;
  shortP: number;
  openP: number;
  closeP: number;
  holdP: number;
  latencyMs: number;
  inputTokens: number;
}

function pack(o: Packed): ModelDecision {
  const action = quoteAction(o.intent, o.bias);
  // long/short and open/close/hold are each a distribution. buy/sell are the legacy
  // pair: the mass behind the order actually being sent, discounted by the hold mass.
  const conviction = action === "buy"
    ? Math.max(o.longP, o.openP)
    : action === "sell"
      ? Math.max(o.shortP, o.closeP)
      : 0;
  const sized = conviction * (1 - o.holdP);
  return {
    action,
    intent: o.intent,
    bias: o.bias,
    leverage: o.leverage,
    probabilities: {
      buy: action === "buy" ? sized : 0,
      sell: action === "sell" ? sized : 0,
      hold: o.holdP,
      long: o.longP,
      short: o.shortP,
      open: o.openP,
      close: o.closeP,
    },
    upIn10: o.longP,
    latencyMs: o.latencyMs,
    inputTokens: o.inputTokens,
  };
}

function normChoice(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

function pick<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  const n = normChoice(raw);
  return (allowed as readonly string[]).includes(n) ? n as T : fallback;
}

function pickKnown<T extends string>(raw: unknown, allowed: readonly T[]): T | null {
  const n = normChoice(raw);
  return (allowed as readonly string[]).includes(n) ? n as T : null;
}

/** Normalize a choice answer over `keys`. Missing probabilities fall back to the pick. */
function choiceProbs(answer: ChoiceAnswer | undefined, keys: readonly string[]): Record<string, number> {
  const choice = normChoice(answer?.choice);
  const p = answer?.probabilities ?? {};
  const raw = keys.map((k) => Math.max(0, p[k] ?? (choice === k ? 1 : 0)));
  const sum = raw.reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  if (sum <= 0) {
    const at = keys.indexOf(choice);
    if (at < 0) {
      keys.forEach((k) => { out[k] = 1 / keys.length; });
      return out;
    }
    keys.forEach((k, i) => { out[k] = i === at ? 1 : 0; });
    return out;
  }
  keys.forEach((k, i) => { out[k] = raw[i]! / sum; });
  return out;
}

type ChoiceAnswer = { choice?: string; probabilities?: Record<string, number> };
type JevAnswers = { bias?: ChoiceAnswer; intent?: ChoiceAnswer; leverage?: ChoiceAnswer };

/** Map a Jev answer set onto one tick. A side we cannot read is a hold, not a long. */
export function decideFromJevAnswers(
  answers: JevAnswers,
  positionSide: "long" | "short" | "flat",
  maxLeverage: number,
  currentLeverage: number | null,
  latencyMs = 0,
  inputTokens = 0,
): ModelDecision {
  const flat = positionSide === "flat";
  const biasPick = pickKnown(answers.bias?.choice, ["long", "short"] as const);
  const choices = flat ? (["open", "hold"] as const) : (["open", "close", "hold"] as const);
  const intent = liveIntent(positionSide, biasPick ? pick(answers.intent?.choice, choices, "hold") : "hold");
  const dir = choiceProbs(answers.bias, ["long", "short"]);
  const act = choiceProbs(answers.intent, choices);
  return pack({
    intent,
    bias: biasPick ?? "long",
    leverage: parseLeverage(answers.leverage?.choice, maxLeverage, currentLeverage ?? 1),
    longP: dir.long!,
    shortP: dir.short!,
    openP: act.open!,
    closeP: act.close ?? 0,
    holdP: act.hold!,
    latencyMs,
    inputTokens,
  });
}

let typesafe: TypeSafeClient | undefined;

function typesafeClient(): TypeSafeClient {
  return (typesafe ??= new TypeSafeClient({
    apiKey: process.env.TYPESAFE_API_KEY,
    defaultModel: config.lab.jevModelId,
    retry: { maxRetries: 0 },
  }));
}

const JEV_DEADLINE_MS = 4000;

export function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`jev timeout ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

async function callJev(state: TradeState): Promise<{ answers: JevAnswers; inputTokens: number }> {
  const seen = marketFacing(state);
  const qs = jevQuestions(state);
  const run = async () => {
    if (config.lab.jevProvider === "gateway") {
      const r = await evaluate({
        model: config.lab.jevModelId,
        state: seen as never,
        questions: qs,
        maxRetries: 0,
      });
      return { answers: r.answers, inputTokens: r.usage?.inputTokens ?? 0 };
    }
    const r = await typesafeClient().systemOne(
      {
        model: config.lab.jevModelId,
        state: seen as never,
        questions: qs,
      },
      { retry: { maxRetries: 0 } },
    );
    return { answers: r.answers, inputTokens: r.usage.input_tokens ?? 0 };
  };
  return withDeadline(run(), JEV_DEADLINE_MS);
}

/** Real Jev. JEV_PROVIDER selects official TypeSafe or Vercel AI Gateway. */
export class JevModel implements Model {
  readonly name = "jev";

  async decide(state: TradeState): Promise<ModelDecision> {
    const t0 = performance.now();
    const r = await callJev(state);
    return decideFromJevAnswers(
      r.answers,
      state.position.side,
      state.maxLeverage,
      state.position.leverage,
      performance.now() - t0,
      r.inputTokens,
    );
  }
}

/** Deterministic stand-in: momentum + imbalance. Jev-shaped open/close/hold/long/short/leverage. */
export class MockModel implements Model {
  readonly name = "mock";

  async decide(state: TradeState): Promise<ModelDecision> {
    const t0 = performance.now();
    const flow = state.trades.buySz + state.trades.sellSz ? state.trades.cvdSz / (state.trades.buySz + state.trades.sellSz) : 0;
    const signal = state.returnsBps.last20 / 8 + state.bookImbalance * 1.5 + flow * 2 + this.noise(state.tick);
    const longP = 1 / (1 + Math.exp(-signal));
    const bias: Bias = longP >= 0.5 ? "long" : "short";
    const against = (bias === "long" && state.position.side === "short") || (bias === "short" && state.position.side === "long");
    // A weak signal is not worth a round trip, so stand down instead of forcing a side.
    const weak = Math.abs(signal) < 0.35;
    const picked: Intent = against ? "close" : weak ? "hold" : "open";
    const intent = liveIntent(state.position.side, picked);
    const holdP = intent === "hold" ? 0.7 : 0.15;
    const closeP = intent === "close" ? 0.7 : 0.15;
    const leverage = parseLeverage(1 + Math.abs(signal) * 8, state.maxLeverage, state.position.leverage ?? 1);
    await Bun.sleep(80);
    return pack({
      intent,
      bias,
      leverage,
      longP,
      shortP: 1 - longP,
      openP: Math.max(0, 1 - holdP - closeP),
      closeP,
      holdP,
      latencyMs: performance.now() - t0,
      inputTokens: Math.round(JSON.stringify(state).length / 4),
    });
  }

  private noise(tick: number) {
    let h = tick * 2654435761 >>> 0;
    h ^= h >>> 15; h = (h * 2246822519) >>> 0; h ^= h >>> 13;
    return ((h % 1000) / 1000 - 0.5) * 3;
  }
}

export const createModel = (): Model => {
  if (config.lab.model !== "jev") return new MockModel();
  assertJevCredentials(config.lab.model, config.lab.jevProvider, process.env);
  return new JevModel();
};

/* ------------------------------------------------------------------ *
 * Caminho da fusao: entra a linha curta, sai o veredicto tipado.
 * O cliente e o mesmo (`systemOne` / ramo Gateway); o que muda e o
 * `state` (<=12 palavras, zero digitos) e as perguntas do policy file.
 * ------------------------------------------------------------------ */

let policyCache: PolicyFile | undefined;

function policyOf(path = config.lab.policyFile): PolicyFile {
  return (policyCache ??= loadPolicyFile(path));
}

const ACTS: readonly Act[] = ["buy", "sell", "hold"];

/** Sem resposta valida nao ha lado: o RISK congela o livro (spec 2.2.4). */
function failedVerdict(cycleId: string, note: string): Verdict {
  return {
    cycle_id: cycleId,
    model: config.lab.jevModelId,
    latency_ms: 0,
    act: "hold",
    act_probs: { buy: 0, sell: 0, hold: 1 },
    act_conf: 0,
    too_hostile: 0,
    raw_ok: false,
    note,
  };
}

/** Parse defensivo da resposta `choice` (spec 4.2). */
export function readChoiceAnswer(raw: unknown): { act: Act; conf: number; probs: Record<Act, number> } | null {
  const a = raw as { type?: unknown; choice?: unknown; confidence?: unknown; probabilities?: Record<string, unknown> } | undefined;
  if (!a || a.type !== "choice") return null;
  const act = typeof a.choice === "string" ? a.choice.trim().toLowerCase() : "";
  if (!(ACTS as readonly string[]).includes(act)) return null;
  const p = a.probabilities ?? {};
  // Estrito de proposito: `Number(null)` e `Number("")` sao 0, e um campo ausente
  // lido como zero e fail-open. Sem numero real, a resposta nao vale.
  const probs: number[] = [];
  for (const k of ACTS) {
    const v = p[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
    probs.push(v);
  }
  const sum = probs.reduce((x, y) => x + y, 0);
  // A API arredonda a 2 casas: a soma admite +-0.02 (spec 4.2).
  if (Math.abs(sum - 1) > 0.02) return null;
  const conf = a.confidence;
  if (typeof conf !== "number" || !Number.isFinite(conf) || conf < 0 || conf > 1) return null;
  return { act: act as Act, conf, probs: { buy: probs[0]!, sell: probs[1]!, hold: probs[2]! } };
}

/**
 * Parse defensivo da resposta `noul`: P(sim) em [0,1] (spec 4.2).
 * Tambem estrito: um `noul` nulo ou em texto tem de **congelar** o ciclo, nunca
 * ser lido como "livro nao hostil" (decisao D3 e invariante 4).
 */
export function readNoulAnswer(raw: unknown): number | null {
  const a = raw as { type?: unknown; noul?: unknown } | undefined;
  if (!a || a.type !== "noul") return null;
  const n = a.noul;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return n >= 0 && n <= 1 ? n : null;
}

/**
 * A chamada ao Jev. O tipo existe para os testes poderem provar, sem rede, o
 * mapa falha -> `raw_ok=false` (spec 4.2 e decisao D3) que os gates consomem.
 */
export type AskJev = (
  state: string,
  questions: Questions,
) => Promise<{ answers: Record<string, unknown>; model: string; tokens: number }>;

/** O cliente de sempre: TypeSafe `systemOne` ou o ramo Gateway. Uma por ciclo, sem retry. */
const defaultAsk: AskJev = async (state, questions) => {
  if (config.lab.jevProvider === "gateway") {
    const r = await evaluate({
      model: config.lab.jevModelId,
      state: state as never,
      questions: questions as never,
      maxRetries: 0,
    });
    return {
      answers: r.answers as unknown as Record<string, unknown>,
      model: config.lab.jevModelId,
      tokens: r.usage?.inputTokens ?? 0,
    };
  }
  const r = await typesafeClient().systemOne(
    { model: config.lab.jevModelId, state, questions },
    { retry: { maxRetries: 0 } },
  );
  return {
    answers: r.answers as unknown as Record<string, unknown>,
    model: r.model,
    tokens: r.usage.input_tokens ?? 0,
  };
};

/** O Jev da fusao: uma request por sleeve por ciclo, sem retry no tick. */
export class JevPolicy implements Policy {
  readonly name = "jev";

  constructor(private policy: PolicyFile = policyOf(), private jev: AskJev = defaultAsk) {}

  async decide(state: string, cycleId: string): Promise<Verdict> {
    const t0 = performance.now();
    // A POLICY so ve as doze palavras: o asset vem do proprio cycle_id e a
    // estance, do bucket de inventario dentro do state.
    const asset = cycleId.split("-").at(-1) ?? "?";
    const questions = askQuestions(this.policy, { asset, stance: stanceFromState(state) });
    try {
      const r = await withDeadline(this.jev(state, questions), config.lab.jevTimeoutMs);
      const act = readChoiceAnswer(r.answers.act);
      const hostile = readNoulAnswer(r.answers.too_hostile);
      if (!act || hostile === null) return failedVerdict(cycleId, "parse");
      return {
        cycle_id: cycleId,
        model: r.model,
        latency_ms: Math.round(performance.now() - t0),
        act: act.act,
        act_probs: act.probs,
        act_conf: act.conf,
        too_hostile: hostile,
        raw_ok: true,
        input_tokens: r.tokens,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return failedVerdict(cycleId, /timeout/i.test(msg) ? "timeout" : "transport");
    }
  }
}

/** `null` = sem `POLICY`: o tick segue o caminho legado. */
export function createPolicy(): Policy | null {
  if (config.policy === "dumb") return new DumbPolicy();
  if (config.policy === "numeric") return new NumericPolicy();
  if (config.policy === "stance") return new StancePolicy();
  if (config.policy === "jev") {
    assertJevCredentials(
      "jev",
      config.lab.jevProvider,
      process.env as { TYPESAFE_API_KEY?: string; AI_GATEWAY_API_KEY?: string },
    );
    return new JevPolicy();
  }
  return null;
}
