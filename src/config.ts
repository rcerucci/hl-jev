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

export type PolicyMode = "" | "jev" | "dumb";

/**
 * `POLICY` escolhe o caminho da fusao. Sem `POLICY`, o repo corre como sempre
 * correu: quem decide e o `MODEL` (mock ou jev numerico). Nao ha segunda fonte
 * de verdade para testnet/mainnet — `HL_TESTNET` continua a ser a unica.
 */
export function resolvePolicy(e: { POLICY?: string }): PolicyMode {
  const v = e.POLICY?.trim().toLowerCase();
  if (!v) return "";
  if (v === "jev" || v === "dumb") return v;
  throw new Error("POLICY must be jev or dumb");
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

export const config = {
  hlTestnet,
  tickMs: Number(env("TICK_MS", "2000")),
  /** Book/price prints for the chart. Independent of Jev ticks. */
  priceMs: Math.max(50, Number(env("PRICE_MS", "200"))),
  explorerTx: hlTestnet
    ? "https://app.hyperliquid-testnet.xyz/explorer/tx/"
    : "https://app.hyperliquid.xyz/explorer/tx/",
  privateKey: env("PRIVATE_KEY"),
  dryRun: env("DRY_RUN") === "true",
  /** Target notional of one post-only quote. */
  quoteUsd: Number(env("QUOTE_USD", "40")),
  quoteInsideTicks: Number(env("QUOTE_INSIDE_TICKS", "1")),
  /** How far an Ioc exit crosses the touch so it fills on the spot. */
  closeSlippageBps: Number(env("CLOSE_SLIPPAGE_BPS", "5")),
  horizonBlocks: Number(env("HORIZON_BLOCKS", "100")),
  model: env("MODEL", "mock") as "mock" | "jev",
  /** typesafe = official TypeSafe API. gateway = Vercel AI Gateway. */
  jevProvider,
  jevModelId,
  jevUsdPerMTok: 0.042,
  /** "" = caminho legado (o MODEL decide). jev | dumb = caminho da fusao. */
  policy: resolvePolicy(process.env as { POLICY?: string }),
  policyFile: envStr("POLICY_FILE", "./policy/jev_questions.json"),
  ledgerDir: envStr("LEDGER_DIR", "./data/ledger"),
  /** Timeout curto do path quente da fusao (spec 4.1). */
  jevTimeoutMs: Number(env("JEV_TIMEOUT_MS", "800")),
  confAct: Number(env("JEV_CONF_ACT", "0.80")),
  hostileTh: Number(env("NOUL_HOSTILE_TH", "0.65")),
  stateMaxWords: Number(env("STATE_MAX_WORDS", "12")),
  outcomeHorizonSecs: Number(env("OUTCOME_HORIZON_SECS", "900")),
  /** Alavancagem do caminho da fusao: o modelo nao escolhe (spec, ganchos). */
  leverage: Number(env("LEVERAGE", "1")),
  /** Livro mais velho que isto congela o livro em vez de decidir (spec 3.6). */
  bookStaleMs: Number(env("BOOK_STALE_MS", "5000")),
  port: Number(env("PORT", "3000")),
  historySize: 1000,
  bankrollUsd: Number(env("BANKROLL_USD", "200")),
};

export function hexKey(key: string): `0x${string}` {
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
}
