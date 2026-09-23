/**
 * VENUE -> LEDGER: o adaptador das marcas.
 *
 * Vive aqui, e nao dentro do worker, para o LEDGER nao importar o cliente da
 * Hyperliquid: o `outcome.ts` recebe uma funcao, e esta e a implementacao real
 * (candles publicos de 1m + historico de funding). Nos testes injecta-se outra.
 */
import { HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { config } from "../config";

export interface Marks {
  /** Fecho da vela que cobre o instante da decisao. */
  then: number | null;
  /** Fecho da vela que cobre o instante do horizonte. */
  plus: number | null;
  /** Soma das taxas de funding no intervalo, por unidade de notional (nao USD). */
  funding: number | null;
}

export type MarkSource = (coin: string, from: number, to: number) => Promise<Marks>;

export const CANDLE_MS = 60_000;
export const MARK_INTERVAL = "1m";

export function transportFor(testnet = config.hlTestnet): HttpTransport {
  return new HttpTransport({ isTestnet: testnet });
}

/** Fecha a vela de 1m que cobre `at`: a ultima com abertura menor ou igual. */
export function closeAt(candles: readonly { t: number; c: string }[], at: number): number | null {
  let best: { t: number; c: string } | null = null;
  for (const candle of candles) {
    if (candle.t <= at && (best === null || candle.t > best.t)) best = candle;
  }
  if (best === null) return null;
  const px = Number(best.c);
  return Number.isFinite(px) && px > 0 ? px : null;
}

/** Soma as taxas de funding cujo instante cai em (from, to]. */
export function sumFunding(rows: readonly { fundingRate: string; time: number }[], from: number, to: number): number {
  let sum = 0;
  for (const row of rows) {
    if (row.time > from && row.time <= to) {
      const rate = Number(row.fundingRate);
      if (Number.isFinite(rate)) sum += rate;
    }
  }
  return sum;
}

export class HlMarkSource {
  private info: InfoClient;

  constructor(info?: InfoClient) {
    this.info = info ?? new InfoClient({ transport: transportFor() });
  }

  /** Duas marcas do mesmo mercado e da mesma fonte: e o que torna o hit coerente. */
  marks = async (coin: string, from: number, to: number): Promise<Marks> => {
    const candles = await this.info.candleSnapshot({
      coin,
      interval: MARK_INTERVAL,
      startTime: from - CANDLE_MS,
      endTime: to,
    });
    const then = closeAt(candles, from);
    const plus = closeAt(candles, to);
    if (then === null || plus === null) return { then, plus, funding: null };
    const rows = await this.info.fundingHistory({ coin, startTime: from, endTime: to });
    return { then, plus, funding: sumFunding(rows, from, to) };
  };
}
