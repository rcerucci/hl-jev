/**
 * Contratos de dados congelados da fusao (spec sec. 3) e a porta que o RISK
 * consome da camada POLICY. Aqui so ha dados e assinaturas.
 *
 * Atencao ao nome: `Intent` deste repo (src/types.ts) significa open|close|hold
 * e continua a existir. O intent da fusao chama-se `RiskIntent` (decisao D2).
 */

export type Act = "buy" | "sell" | "hold";
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
  | "frozen_stale";

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
  decide(state: string, cycleId: string): Promise<Verdict>;
}
