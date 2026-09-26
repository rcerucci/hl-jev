/**
 * F6 — nocional da entrada.
 *
 * `HL_COINS=BTC,SOL` → 2 pares → cada um usa saldo/2.
 * Um par usa o saldo inteiro. Live: o saldo entra limitado a `maxLiveEquityUsd`.
 * Flatten não passa por aqui.
 */
export function entryNotional(
  equity: number,
  leverage: number,
  opts: { dryRun: boolean; capUsd: number; pairs?: number },
): number {
  const n = Math.max(1, Math.floor(opts.pairs ?? 1));
  const base = opts.dryRun ? equity : Math.min(equity, opts.capUsd);
  if (!(base > 0) || !(leverage > 0)) return 0;
  return (base / n) * leverage;
}
