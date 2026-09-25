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
 * `POLICY` escolhe o caminho da fusao. Sem `POLICY`, o repo corre como sempre
 * correu: quem decide e o `MODEL` (mock ou jev numerico). Nao ha segunda fonte
 * de verdade para testnet/mainnet — `HL_TESTNET` continua a ser a unica.
 */
export function resolvePolicy(e: { POLICY?: string }): PolicyMode {
  const v = e.POLICY?.trim().toLowerCase();
  if (!v) return "";
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

/**
 * H4 — o motor desta conta, numa fonte so. O `policy/sigma.ts`, o fill e o trader **nao** tem
 * constantes proprias: leem daqui. (O stance fica com o L/chao/teto dele: e museu.)
 */
const sigma = {
  /** Barras H1 da EMA do `s`. */
  emaN: 24,
  /** Circuit breaker de chop: viradas na janela que armam a caixa, a janela, e a caixa. */
  cbFlips: 3,
  cbWindowMs: 12 * 3_600_000,
  cbCaixaMs: 6 * 3_600_000,
  /** A espera do ALO no touch antes de o que sobra ir a mercado (F5). */
  aloWaitMs: 8000,
  /** Taxas assumidas no paper (tier 0) e a distancia ao touch: 0 = no touch. */
  makerFeeBps: 1.5,
  takerFeeBps: 4.5,
  quoteInsideTicks: 0,
};

/** H4 — o laboratorio: Jev, noul, MODEL, POLICY_FILE. O alfa nao le nada disto. */
const lab = {
  model: env("MODEL", "mock") as "mock" | "jev",
  policyFile: envStr("POLICY_FILE", "./policy/jev_questions.json"),
  /** typesafe = official TypeSafe API. gateway = Vercel AI Gateway. */
  jevProvider,
  jevModelId,
  /** Timeout curto do path quente da fusao (spec 4.1). */
  jevTimeoutMs: Number(env("JEV_TIMEOUT_MS", "800")),
  jevUsdPerMTok: 0.042,
  confAct: Number(env("JEV_CONF_ACT", "0.80")),
  hostileTh: Number(env("NOUL_HOSTILE_TH", "0.65")),
  stateMaxWords: Number(env("STATE_MAX_WORDS", "12")),
  /** Tamanho do caminho legado. O sigma dimensiona por `bankrollUsd x leverage`. */
  quoteUsd: Number(env("QUOTE_USD", "40")),
  /** Distancia ao touch dos outros caminhos. O sigma entra no touch (`sigma.quoteInsideTicks = 0`). */
  quoteInsideTicks: Number(env("QUOTE_INSIDE_TICKS", "1")),
};

export const config = {
  hlTestnet,
  /** "" = caminho legado (o MODEL decide). jev | dumb | numeric | stance | sigma = caminho da fusao. */
  policy: resolvePolicy(process.env as { POLICY?: string }),
  dryRun: env("DRY_RUN") === "true",
  privateKey: env("PRIVATE_KEY"),
  /** Alavancagem do caminho da fusao: o modelo nao escolhe (spec, ganchos). */
  leverage: Number(env("LEVERAGE", "1")),
  bankrollUsd: Number(env("BANKROLL_USD", "200")),
  /** H4 — tecto da conta do alfa quando e dinheiro real (o porteiro recusa acima disto). */
  maxLiveEquityUsd: 100,
  sigma,
  lab,
  tickMs: Number(env("TICK_MS", "2000")),
  /** Book/price prints for the chart. Independent of Jev ticks. */
  priceMs: Math.max(50, Number(env("PRICE_MS", "200"))),
  explorerTx: hlTestnet
    ? "https://app.hyperliquid-testnet.xyz/explorer/tx/"
    : "https://app.hyperliquid.xyz/explorer/tx/",
  /** How far an Ioc exit crosses the touch so it fills on the spot. */
  closeSlippageBps: Number(env("CLOSE_SLIPPAGE_BPS", "5")),
  horizonBlocks: Number(env("HORIZON_BLOCKS", "100")),
  ledgerDir: envStr("LEDGER_DIR", "./data/ledger"),
  outcomeHorizonSecs: Number(env("OUTCOME_HORIZON_SECS", "900")),
  /** Livro mais velho que isto congela o livro em vez de decidir (spec 3.6). */
  bookStaleMs: Number(env("BOOK_STALE_MS", "5000")),
  port: Number(env("PORT", "3000")),
  historySize: 1000,
};

export function hexKey(key: string): `0x${string}` {
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
}
