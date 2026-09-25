import { config } from "./config";
import { bpsBetween, snapshotIndicators, venueFeatures } from "./indicators";
import type { Market } from "./market";
import type { Model, ModelDecision, TradeState } from "./model";
import { planFromRisk, planQuote, type QuotePlan } from "./plan";
import { toSnapshot, toState } from "./risk/buckets";
import { isFrozen, riskIntent, standsDown } from "./risk/intent";
import type { Policy, PolicyCtx, Snapshot, StanceRaw, Verdict } from "./risk/types";
import { stanceFeatures, type StanceBar } from "./policy/stance_features";
import { cycleId, type Ledger } from "./ledger/jsonl";
import { aggregateFills, emptySummary, takeLiveFills, takeSimFills, type Resting, type TradeFeed } from "./trades";
import type { BlockEvent, Book, Fill, PricePoint, Quote, Side, Timing, Totals } from "./types";

const emptyTotals = (): Totals => ({
  blocks: 0, decisions: 0, quotes: 0, fills: 0, reverted: 0, lateBlocks: 0,
  jevUsd: 0, gasSz: 0, gasUsd: 0, realizedUsd: 0, pnlUsd: 0, pnlSz: 0, pnlPct: 0,
});

const JEV_PAUSE_MS = 30_000;

export function jevUnavailable(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /402\b|no available TypeSafe API credits|insufficient credits/i.test(msg);
}
