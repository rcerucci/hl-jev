const env = (key: string, fallback?: string) => process.env[key] ?? fallback;
/** Env com default obrigatorio: o campo sai `string`, nunca `string | undefined`. */
const envStr = (key: string, fallback: string) => env(key, fallback) ?? fallback;

export type JevProvider = "typesafe" | "gateway";

export function resolveJevProvider(e: {
  JEV_PROVIDER?: string;
  TYPESAFE_API_KEY?: string;
  AI_GATEWAY_API_KEY?: string;
}): JevProvider {
  const explicit = e.JEV_PROVIDER?.trim().toLowerCase();
  if (explicit === "typesafe" || explicit === "gateway") return explicit;
  if (explicit) throw new Error("JEV_PROVIDER must be typesafe or gateway");
  if (e.TYPESAFE_API_KEY?.trim()) return "typesafe";
  if (e.AI_GATEWAY_API_KEY?.trim()) return "gateway";
  return "typesafe";
}

export function resolveJevModelId(e: { JEV_MODEL_ID?: string }, provider: JevProvider): string {
  const set = e.JEV_MODEL_ID?.trim();
  if (set) return set;
  return provider === "gateway" ? "typesafe-ai/jev" : "jev-latest";
}

export type PolicyMode = "" | "jev" | "dumb" | "numeric" | "stance" | "sigma";

/**
 * Sem POLICY o motor e sigma. Os outros nomes ficam no laboratorio; o porteiro
 * recusa-os no start desta conta.
 */
export function resolvePolicy(e: { POLICY?: string }): PolicyMode {
  const v = e.POLICY?.trim().toLowerCase();
  if (!v) return "sigma";
  if (v === "jev" || v === "dumb" || v === "numeric" || v === "stance" || v === "sigma") return v;
  throw new Error("POLICY must be jev, dumb, numeric, stance or sigma");
}

export function assertJevCredentials(
  model: string,
  provider: JevProvider,
  e: { TYPESAFE_API_KEY?: string; AI_GATEWAY_API_KEY?: string },
): void {
  if (model !== "jev") return;
  if (provider === "typesafe" && !e.TYPESAFE_API_KEY?.trim()) {
    throw new Error("MODEL=jev with JEV_PROVIDER=typesafe needs TYPESAFE_API_KEY. Get a key at https://docs.typesafe.ai/ or set JEV_PROVIDER=gateway with AI_GATEWAY_API_KEY.");
  }
  if (provider === "gateway" && !e.AI_GATEWAY_API_KEY?.trim()) {
    throw new Error("MODEL=jev with JEV_PROVIDER=gateway needs AI_GATEWAY_API_KEY. Or set JEV_PROVIDER=typesafe with TYPESAFE_API_KEY.");
  }
}

const hlTestnet = env("HL_TESTNET", "true") !== "false";
const jevProvider = resolveJevProvider(process.env);
const jevModelId = resolveJevModelId(process.env, jevProvider);

export function resolveCbFlips(
  e: Record<string, string | undefined>,
): { value: number; source: "env" | "config" } {
  const set = e.CB_FLIPS?.trim();
  if (!set) return { value: 4, source: "config" };
  return { value: Number(set), source: "env" };
}

export function resolveCbHours(
  e: Record<string, string | undefined>,
  key: string,
  fallback: number,
): { value: number; source: "env" | "config" } {
  const set = (e[key] ?? "").trim();
  if (!set) return { value: fallback, source: "config" };
  return { value: Number(set), source: "env" };
}

const cbFlips = resolveCbFlips(process.env);
const cbWindow = resolveCbHours(process.env, "CB_WINDOW_H", 12);
const cbCaixa = resolveCbHours(process.env, "CB_CAIXA_H", 6);

const sigma = {
  emaN: 24,
  cbFlips: cbFlips.value,
  cbFlipsSource: cbFlips.source,
  cbWindowMs: cbWindow.value * 3_600_000,
  cbCaixaMs: cbCaixa.value * 3_600_000,
  aloWaitMs: 8000,
  makerFeeBps: 1.5,
  takerFeeBps: 4.5,
  quoteInsideTicks: 0,
};

const lab = {
  model: env("MODEL", "mock") as "mock" | "jev",
  policyFile: envStr("POLICY_FILE", "./policy/jev_questions.json"),
  jevProvider,
  jevModelId,
  jevTimeoutMs: Number(env("JEV_TIMEOUT_MS", "800")),
  jevUsdPerMTok: 0.042,
  confAct: Number(env("JEV_CONF_ACT", "0.80")),
  hostileTh: Number(env("NOUL_HOSTILE_TH", "0.65")),
  stateMaxWords: Number(env("STATE_MAX_WORDS", "12")),
  quoteUsd: Number(env("QUOTE_USD", "40")),
  quoteInsideTicks: Number(env("QUOTE_INSIDE_TICKS", "1")),
};

export const config = {
  hlTestnet,
  /** Default sigma. */
  policy: resolvePolicy(process.env as { POLICY?: string }),
  dryRun: env("DRY_RUN") === "true",
  privateKey: env("PRIVATE_KEY"),
  leverage: Number(env("LEVERAGE", "1")),
  bankrollUsd: Number(env("BANKROLL_USD", "200")),
  maxLiveEquityUsd: 100,
  sigma,
  lab,
  tickMs: Number(env("TICK_MS", "2000")),
  priceMs: Math.max(50, Number(env("PRICE_MS", "200"))),
  explorerTx: hlTestnet
    ? "https://app.hyperliquid-testnet.xyz/explorer/tx/"
    : "https://app.hyperliquid.xyz/explorer/tx/",
  closeSlippageBps: Number(env("CLOSE_SLIPPAGE_BPS", "5")),
  horizonBlocks: Number(env("HORIZON_BLOCKS", "100")),
  ledgerDir: envStr("LEDGER_DIR", "./data/ledger"),
  regimeDir: envStr("REGIME_DIR", "./data/regime"),
  outcomeHorizonSecs: Number(env("OUTCOME_HORIZON_SECS", "900")),
  bookStaleMs: Number(env("BOOK_STALE_MS", "5000")),
  port: Number(env("PORT", "3000")),
  historySize: 1000,
};

export function hexKey(key: string): `0x${string}` {
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
}
