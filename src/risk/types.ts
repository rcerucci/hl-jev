/**
 * Contratos de dados congelados da fusao (spec sec. 3) e a porta que o RISK
 * consome da camada POLICY. Aqui so ha dados e assinaturas.
 *
 * Atencao ao nome: `Intent` deste repo (src/types.ts) significa open|close|hold
 * e continua a existir. O intent da fusao chama-se `RiskIntent` (decisao D2).
 */

export type Act = "buy" | "sell" | "hold";
export type StanceRaw = "buy" | "sell" | "caixa";
export type StanceSignal = "buy" | "sell" | "hold" | "caixa";
export type Urgency = "maker" | "taker" | "none";

/**
 * Spec 3.1 — numeros, e o Jev **nao** ve este objecto.
 *
 * Duas correccoes deliberadas ao exemplo da spec, com o motivo:
 * - `funding_bps` em vez de `funding_8h`: a Hyperliquid publica taxa **horaria**,
 *   e e o horario que o repo ja usa (venueFeatures multiplica por 10_000);
 * - `depth_usd_10bps` em vez de `depth_usd_2bps`: o livro deste executor so
 *   agrega bandas de 10/25/50 bps (src/book.ts), logo a banda de 2 bps nao existe
 *   sem inventar dado novo.
 * Os campos de `tape`/`flow` nao constam do exemplo 3.1 mas a vocabulario 3.2
 * exige-os (pumping/dumping/bot_war): o snapshot foi acrescentado, nao reduzido.
 */
export interface Snapshot {
  ts: number;
  sleeve: string;
  coin: string;
  mid: number;
  mark: number | null;
  bid: number;
  ask: number;
  spread_bps: number;
  bid_sz: number;
  ask_sz: number;
  depth_usd_10bps: number;
  funding_bps: number | null;
  pos_side: "long" | "short" | "flat";
  pos_sz: number;
  pos_notional_usd: number;
  upnl_usd: number;
  lev: number | null;
  book_age_ms: number;
  returns_bps: { last1: number; last5: number; last20: number };
  vol_bps: number | null;
  prints: { count: number; buy_sz: number; sell_sz: number; cvd_sz: number };
  equity_usd: number;
  bankroll_usd: number;
  max_leverage: number;
}

/** Spec 3.4 — saida ja parseada do Jev. */
export interface Verdict {
  cycle_id: string;
  model: string;
  latency_ms: number;
  act: Act;
  act_probs: Record<Act, number>;
  /** `ChoiceResponse.confidence` do SDK: campo proprio, distinto de act_probs. */
  act_conf: number;
  /** `NoulResponse.noul`: P(sim) em [0,1]. */
  too_hostile: number;
  raw_ok: boolean;
  /** Diagnostico apenas: nao faz parte da decisao. */
  note?: string;
  input_tokens?: number;
  /**
   * #45 — o `s` que a **policy usou** para decidir, e a EMA dele. O ledger grava este, nao uma
   * segunda computacao do mesmo sinal: enquanto `ctx.s` e o `s` do decisor vierem de sitios
   * diferentes, o motor tem duas verdades e o que regista nao e o que executa.
   */
  s?: number;
  ema_h1?: number | null;
  /**
   * Sigma: a barra H1 que a decisao LEU - instante de abertura, `hl2` e `close` dela. E o que
   * permite ao painel mostrar a barra que decidiu, e nao o preco vivo do grafico (que e outro
   * objecto, e a razao pela qual a leitura no TV divergia do motor).
   */
  bar_t?: number;
  hl2?: number;
  bar_close?: number;
  /** Postura de inventário (POLICY=stance). Ausente nas outras policies. */
  raw?: StanceRaw;
  /** Evento publicado: hold sse raw == raw anterior. */
  signal?: StanceSignal;
  /** Sigma (F2): esta barra H1 foi ignorada por so o wick ter cruzado a EMA. */
  wick_veto?: boolean;
  /**
   * F5 — hold do **portao do relogio**: a postura nao mudou e nao houve evento nenhum. Nao e
   * caixa (nao desmonta nada) nem hold de sinal: e o tick a passar sem uma H1 fechada nova.
   */
  clock_hold?: boolean;
  /** F3 — o circuit breaker de chop esta a segurar o capital fora do mercado. */
  cb_active?: boolean;
  /** Viradas de lado nas ultimas 12 h de H1 fechadas (0 quando o CB acabou de expirar). */
  cb_flips_12h?: number;
  /** Fim da caixa do CB, em ms epoch. 0 quando nao ha CB armado. */
  cb_until?: number;
}

/** Vela H1 que o sigma consome: `hl2` sai de high/low, e o `close` decide o veto de pavio. */
export interface SigmaBar {
  t: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Spec 3.5 — a unica coisa que o executor consome. Sem `px`, sem `sz`.
 *
 * `reason` e o que separa os dois tipos de hold da decisao D3:
 * - congelar (sem resposta valida do Jev): nada de ordem nova **e** nada de cancelar;
 * - stand-down (o Jev respondeu hold, ou o codigo recusou por confianca/noul/inventario):
 *   cancela a resting quote.
 * Ver `isFrozen`.
 */
export type IntentReason =
  | "jev_act"
  | "jev_hold"
  | "low_conf"
  | "hostile"
  | "inventory_block"
  | "frozen_timeout"
  | "frozen_raw"
  | "frozen_stale"
  | "caixa"
  | "cb_chop"
  | "stance_hold"
  | "stance_act";

export interface RiskIntent {
  cycle_id: string;
  sleeve: string;
  side: Act;
  urgency: Urgency;
  reduce_only: boolean;
  conf: number;
  reason: IntentReason;
}

/** Porta da camada POLICY: recebe a linha curta e devolve o veredicto. */
export interface Policy {
  readonly name: string;
  decide(state: string, cycleId: string, ctx?: PolicyCtx): Promise<Verdict>;
}

/**
 * Contexto numerico opcional. A porta nasceu com as palavras do `state` apenas, o que chega
 * ao Jev e ao `dumb`; uma regra **numerica** (ensaio N1: `sign(last20)`) precisa do numero, e
 * o adjectivo do `tape` nao o substitui — `grinding` cobre 4–15 bps sem dizer o sentido.
 * Opcional para nao mexer em nada do que ja decide.
 */
export interface PolicyCtx {
  returns_bps: { last1: number; last5: number; last20: number };
  mid_5m?: number;
  u?: number;
  s?: number;
  ema_h1?: number | null;
  raw_prev?: StanceRaw;
  /** Sigma: as velas H1 cruas (com close). O sigma escolhe a ultima fechada pelo instante do ciclo. */
  h1?: SigmaBar[];
}
