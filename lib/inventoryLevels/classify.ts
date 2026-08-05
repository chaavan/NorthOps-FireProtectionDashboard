import type { PartDemand } from "@/lib/inventoryLevels/usage";

/**
 * What the bulk tool should do with a part.
 *
 *  STOCK       - enough demand signal to derive levels from.
 *  DONT_STOCK  - no demand at all (neither pulled from stock nor bought for a job).
 *  LEAVE_BLANK - some demand, but too little/erratic to derive a level from. NOT
 *                flagged: operators demonstrably stock cheap critical fittings that barely
 *                move (Min=50 on a part used once in four months), and usage can't
 *                infer that judgement. Left for him.
 *  SKIP        - hand-set levels already exist; never touched.
 */
export type LevelDecision = "STOCK" | "DONT_STOCK" | "LEAVE_BLANK" | "SKIP";

export type ClassifyInput = {
  hasThresholds: boolean;
  demand: PartDemand | undefined;
};

export type Classification = {
  decision: LevelDecision;
  reason: string;
};

/** Below this many active months a average is a guess, not a trend. */
export const MIN_ACTIVE_MONTHS = 3;

/** Total units of demand below which a part isn't worth stocking. */
export const MIN_TOTAL_DEMAND = 10;

/**
 * "I keep ordering this" thresholds. A part bought this often, across this many
 * separate jobs, is recurring demand — the strongest signal that it belongs on the
 * shelf, even if it has never been stocked and so has no pull history at all.
 */
export const FREQUENT_ORDER_LINES = 3;
export const FREQUENT_ORDER_JOBS = 2;

export function isFrequentlyOrdered(demand: PartDemand): boolean {
  return (
    demand.orderLineCount >= FREQUENT_ORDER_LINES &&
    demand.distinctJobs >= FREQUENT_ORDER_JOBS
  );
}

export function classifyPart(input: ClassifyInput): Classification {
  // Hand-set levels are the one thing we never override.
  //
  // Note: doNotStock is deliberately NOT a skip. Almost every flag was set by this
  // tool, not a person, and the original rule was backwards — it flagged parts BECAUSE
  // they were bought per job, which is exactly the evidence that they should be
  // stocked. Re-evaluating them is how those recover.
  if (input.hasThresholds) {
    return { decision: "SKIP", reason: "Already has Min On Hand / Order Min" };
  }

  const demand = input.demand;
  if (!demand || demand.totalDemand <= 0) {
    return {
      decision: "DONT_STOCK",
      reason: "No demand in the window — never pulled from stock or bought for a job",
    };
  }

  // Recurring purchases win regardless of how thin the stock-pull history is: this is
  // the "I'm ordering this constantly, put it on the shelf" case.
  if (isFrequentlyOrdered(demand)) {
    return {
      decision: "STOCK",
      reason: `Ordered ${demand.orderLineCount}x across ${demand.distinctJobs} jobs (${demand.orderedQty} units bought per-job) — recurring demand, should be stocked`,
    };
  }

  if (demand.activeMonths < MIN_ACTIVE_MONTHS) {
    return {
      decision: "LEAVE_BLANK",
      reason: `Demand in only ${demand.activeMonths} month(s) — too erratic to derive a level; left for review`,
    };
  }

  if (demand.totalDemand < MIN_TOTAL_DEMAND) {
    return {
      decision: "LEAVE_BLANK",
      reason: `Only ${demand.totalDemand} unit(s) of demand — too little to derive a level; left for review`,
    };
  }

  return {
    decision: "STOCK",
    reason: `${demand.totalDemand} units across ${demand.activeMonths} month(s) (${demand.stockUsed} pulled, ${demand.orderedQty} bought per-job)`,
  };
}
