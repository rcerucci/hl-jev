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

/** A banda de tempo do CB: 1 hora ate um ano. Fora disto nao e valor, e erro de operacao. */
export const CB_BAND_MAX_H = 24 * 365;

/** De onde veio o valor que esta a correr: do ambiente (`CB_*`) ou do default daqui. */
export type CbSource = "env" | "config";

/** Um botao do CB: o numero que corre e a origem dele (a bootLine imprime as duas coisas). */
export interface CbKnob {
  readonly value: number;
  readonly source: CbSource;
}

export interface CbKnobs {
  readonly flips: CbKnob;
  readonly windowH: CbKnob;
  readonly caixaH: CbKnob;
}

/** Os defaults do motor. Vivem aqui, e so aqui: nao ha segunda fonte. */
export const CB_DEFAULTS = { flips: 4, windowH: 12, caixaH: 6 } as const;

function cbKnob(
  name: string,
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  why = "",
): CbKnob {
  if (raw === undefined) return { value: fallback, source: "config" };
  // Inteiro decimal e so: `Number` aceita `0x4`, `1e3` e afins, e um limiar escrito assim e um
  // engano, nao um valor. Espaco a volta tolera-se; vazio cai na banda (0) e e recusado.
  const texto = raw.trim();
  const n = Number(texto);
  if (!/^-?\d+$/.test(texto) || !Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name}="${raw}" fora de banda: inteiro entre ${min} e ${max}${why}`);
  }
  return { value: n, source: "env" };
}

/**
 * Issue #37 — o limiar, a janela e a caixa do CB leem-se **aqui** (o `policy/sigma.ts` continua a
 * ler `config.sigma`: fonte unica). `CB_FLIPS`, `CB_WINDOW_H` e `CB_CAIXA_H` sobrepoem-se ao
 * default, e cada botao sabe de onde veio — a bootLine diz `cbFlips=4 (env)` ou `(config)`, para
 * uma divergencia entre a VPS e a `main` nunca ser silenciosa.
 *
 * O porteiro recusa **no arranque** valor fora de banda, em vez de deixar correr um freio que nao
 * trava: janela e caixa inteiras, de 1 h a um ano; o limiar inteiro de 1 ate as horas da janela —
 * conta-se no maximo uma virada por H1 fechada, portanto mais viradas do que horas na janela nunca
 * armam a caixa.
 */
export function resolveCbKnobs(e: {
  CB_FLIPS?: string;
  CB_WINDOW_H?: string;
  CB_CAIXA_H?: string;
}): CbKnobs {
  const windowH = cbKnob("CB_WINDOW_H", e.CB_WINDOW_H, CB_DEFAULTS.windowH, 1, CB_BAND_MAX_H);
  const caixaH = cbKnob("CB_CAIXA_H", e.CB_CAIXA_H, CB_DEFAULTS.caixaH, 1, CB_BAND_MAX_H);
  const flips = cbKnob(
    "CB_FLIPS",
    e.CB_FLIPS,
    CB_DEFAULTS.flips,
    1,
    windowH.value,
    " (as horas de CB_WINDOW_H: acima disso o CB nunca arma)",
  );
  return { flips, windowH, caixaH };
}

const hlTestnet = env("HL_TESTNET", "true") !== "false";
const jevProvider = resolveJevProvider(process.env);
const jevModelId = resolveJevModelId(process.env, jevProvider);
/** A origem de cada botao do CB, para a bootLine. O `config.sigma` fica so com numeros. */
export const cbKnobs: CbKnobs = resolveCbKnobs(process.env);

/**
 * H4 — o motor desta conta, numa fonte so. O `policy/sigma.ts`, o fill e o trader **nao** tem
 * constantes proprias: leem daqui. (O stance fica com o L/chao/teto dele: e museu.)
 */
const sigma = {
  /** Barras H1 da EMA do `s`. */
  emaN: 24,
  /**
   * Circuit breaker de chop: viradas na janela que armam a caixa, a janela, e a caixa. Os defaults
   * vivem aqui (`CB_DEFAULTS`); `CB_FLIPS`, `CB_WINDOW_H` e `CB_CAIXA_H` sobrepoem-se a eles em
   * `resolveCbKnobs`, e a bootLine diz qual dos dois mandou.
   */
  cbFlips: cbKnobs.flips.value,
  cbWindowMs: cbKnobs.windowH.value * 3_600_000,
  cbCaixaMs: cbKnobs.caixaH.value * 3_600_000,
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
