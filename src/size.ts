/**
 * F6 — o nocional da entrada. Live: nunca acima do tecto do alfa
 * (`maxLiveEquityUsd × leverage`). Dry run: saldo × leverage, sem tecto
 * (o porteiro já isenta o BANKROLL de exemplo).
 *
 * Flatten / reduce-only não passam por aqui: o tamanho é a posição.
 */
export function entryNotional(
  equity: number,
  leverage: number,
  opts: { dryRun: boolean; capUsd: number },
): number {
  const raw = equity * leverage;
  if (!(raw > 0)) return 0;
  if (opts.dryRun) return raw;
  const cap = opts.capUsd * leverage;
  if (!(cap > 0)) return 0;
  return Math.min(raw, cap);
}
