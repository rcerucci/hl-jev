/** Wire types. Copied to web/src/lib/bot-types.ts. Keep both files identical. */
export type Action = "buy" | "sell" | "hold";
export type Side = "buy" | "sell";
export type Bias = "long" | "short";
/** `hold` posts nothing and pulls any resting quote. */
export type Intent = "open" | "close" | "hold";

export interface Book {
  block: number;
  bid: number;
  ask: number;
  mid: number;
  spreadBps: number;
  /** (bidDepth - askDepth) / (bidDepth + askDepth) within 1% of mid. -1..1 */
  imbalance: number;
  levels: { bids: [number, number][]; asks: [number, number][] };
  depthBps: { [band: string]: { bid: number; ask: number } };
}

/** This tick's order. Entries are post-only limits, exits are Ioc takers. */
export interface Quote {
  side: Side;
  price: number;
  size: number;
  txHash: string | null;
  cancel: number[];
  status: "placed" | "reverted" | "sim";
  orderId: number | null;
  capped: boolean;
  reduceOnly?: boolean;
  unchanged?: boolean;
  /** Ioc order that crossed the touch instead of resting on it. */
  taker?: boolean;
  /** FIX-42 — o motivo que o venue deu quando a ordem nao entrou (“Post only order would have…”, etc.). */
  reason?: string;
}

/** A taker hit one of our resting orders. */
export interface Fill {
  side: Side;
  size: number;
  price: number;
  txHash: string | null;
  orderId: number;
  simulated: boolean;
  feeUsd?: number;
  closedPnl?: number;
  dir?: "open" | "close" | "flip";
  /** F5 — como a operacao do sigma encheu: maker (o ALO bastou), taker (foi tudo a mercado) ou as duas. */
  role?: "maker" | "taker" | "mixed";
  /** F5 — mid no instante do envio do ALO. */
  mid_at_send?: number;
  /** F5 — o que ainda estava aberto aos 8 s (0 se o ALO encheu tudo). */
  unfilled?: number;
}

/** Compact tape print. Candles carry o/h/l/c. Fills sit on this series. */
export interface PricePoint {
  ts: number;
  mid: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  bar?: "1s" | "1m" | "15m";
  block?: number;
  fill?: {
    side: Side;
    price: number;
    size: number;
    dir?: "open" | "close" | "flip";
    hash?: string;
    closedPnl?: number;
    feeUsd?: number;
  };
}

export interface Decision {
  action: Action;
  intent?: Intent;
  bias?: Bias;
  leverage?: number;
  probabilities: {
    buy: number;
    sell: number;
    hold: number;
    long?: number;
    short?: number;
    open?: number;
    close?: number;
  };
  upIn10: number;
  latencyMs: number;
  late: boolean;
  /** Caminho da fusao: as doze palavras que a POLICY viu, e o veredicto cru. */
  state12?: string;
  act?: Action;
  act_conf?: number;
  too_hostile?: number;
  /** Porque o gate travou (hostile, low_conf, frozen_*, ...). So no caminho da fusao. */
  reason?: string;
  /**
   * Sigma (POLICY=sigma): o estado que a decisao leu, com os **nomes do ledger** - para o painel
   * poder ser cruzado com a linha do ledger a olho. Ausente nas outras policies.
   *
   * `bar_t`/`hl2`/`bar_close` sao da **H1 fechada** que decidiu, e nao do preco vivo do grafico:
   * sao objectos diferentes, e era essa a razao pela qual a leitura no TV divergia do motor.
   */
  s?: number;
  ema_h1?: number | null;
  bar_t?: number;
  hl2?: number;
  bar_close?: number;
  /** `hl2 - ema_h1`: o que o `s` mede. */
  delta?: number;
  /** F2: a barra foi ignorada porque so o pavio cruzou a EMA (o `s` manteve-se). */
  wick_veto?: boolean;
  /** F4/#44: este tick nao liberta entrada (portao do relogio, ou arranque a frio). */
  clock_hold?: boolean;
  /** F3: a caixa do CB de chop esta armada. */
  cb_active?: boolean;
  cb_flips_12h?: number;
  cb_until?: number;
  /** F6: o saldo da sleeve e o notional da entrada em curso (`null` quando nao ha nenhuma). */
  equity?: number;
  notional?: number | null;
}

export interface Position {
  side: "long" | "short" | "flat";
  size: number;
  entryPrice: number | null;
  leverage: number | null;
  unrealizedUsd: number;
  unrealizedSz: number;
}

export interface Totals {
  blocks: number;
  decisions: number;
  quotes: number;
  fills: number;
  reverted: number;
  lateBlocks: number;
  jevUsd: number;
  gasSz: number;
  gasUsd: number;
  realizedUsd: number;
  pnlUsd: number;
  pnlSz: number;
  pnlPct: number;
}

export interface BlockEvent {
  coin: string;
  block: number;
  ts: number;
  mid: number;
  bestBid: number;
  bestAsk: number;
  spreadBps: number;
  decision: Decision | null;
  quote: Quote | null;
  fill: Fill | null;
  resting: { bidSz: number; askSz: number };
  position: Position;
  totals: Totals;
  /** Hyperliquid account equity for this sleeve wallet. */
  accountValue?: number | null;
  withdrawable?: number | null;
}

export interface SleeveMeta {
  coin: string;
  pair: string;
  label: string;
  wallet: string | null;
}

export interface Meta {
  model: string;
  wallet: string | null;
  dryRun: boolean;
  market: string;
  startedAt: number;
  venue: string;
  coin: string;
  pair: string;
  explorerTx: string;
  tickMs: number;
  sleeves: SleeveMeta[];
}

export interface Timing {
  readMs: number;
  loopMs: number;
}
