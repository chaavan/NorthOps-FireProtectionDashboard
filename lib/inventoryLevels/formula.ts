import type { PartUsageStats } from "@/lib/inventoryLevels/usage";

/**
 * Reorder levels derived from observed usage + measured vendor lead time.
 *
 *   demandDuringLT = avgDailyUsage x leadTimeDays
 *   safetyStock    = Z x stddevDaily x sqrt(leadTimeDays)   [capped, see below]
 *   MinOnHand      = roundUp(demandDuringLT + safetyStock)
 *   OrderMin       = roundUp(avgDailyUsage x coverageDays)
 *
 * The cap on safety stock is the important part. TFP's demand is job-driven and
 * lumpy — for some parts the monthly stddev exceeds the mean (a high-volume fitting can
 * average a few thousand a month yet range from hundreds to five figures). The textbook
 * Z*sigma*sqrt(LT) term assumes roughly
 * normal demand and explodes on those parts, so we cap safety stock at a multiple of
 * lead-time demand. That keeps spiky parts sane while leaving steady parts untouched.
 */
export type LevelParams = {
  /** Service-level factor on demand variability. 1.65 ~= 95%. */
  z: number;
  /** How many days of demand a single reorder should cover. */
  coverageDays: number;
  /** Safety stock ceiling, as a multiple of lead-time demand. */
  safetyCapMultiple: number;
};

export const TEXTBOOK_PARAMS: LevelParams = {
  z: 1.65,
  coverageDays: 30,
  safetyCapMultiple: 1,
};

/**
 * How many days of demand one reorder should cover. This is a POLICY choice, not a
 * fitted value, and that distinction matters.
 *
 * Fitting it against the operator's hand-set Order Mins is degenerate: OrderMin =
 * avgDailyUsage x coverageDays, and avgDailyUsage = totalUsed / windowDays, so
 * coverageDays simply converges on windowDays (measured: 120.1 for a 120-day window,
 * 143.1 for a 143-day one) and the prediction collapses to "order everything ever
 * used". That would make Order Min *inflate* as history accumulates instead of
 * improving, which is the opposite of what we want.
 *
 * So we fix it. 120 days matches a four-month buying rhythm. With it
 * fixed, more history sharpens avgDailyUsage and the numbers genuinely improve.
 */
export const CALIBRATED_COVERAGE_DAYS = 120;

export type SuggestedLevels = {
  minOnHand: number;
  orderMin: number;
  /** Pre-rounding intermediates, for the dry-run report. */
  demandDuringLeadTime: number;
  safetyStock: number;
  safetyStockCapped: boolean;
  leadTimeDays: number;
};

/** Snap to a tidy number so purchasing sees 250, not 247. */
export function roundUpToIncrement(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const increment =
    value < 10 ? 1 : value < 50 ? 5 : value < 100 ? 10 : value < 500 ? 25 : value < 1000 ? 50 : 100;
  return Math.ceil(value / increment) * increment;
}

export type DemandInput = {
  avgDailyUsage: number;
  stddevDaily: number;
};

export function computeLevels(
  usage: DemandInput,
  leadTimeDays: number,
  params: LevelParams,
  /** Sample stddev of this vendor's lead time, in days. 0 => treat as reliable. */
  leadTimeStdDevDays = 0,
): SuggestedLevels {
  const lt = Math.max(0, leadTimeDays);
  const ltSd = Math.max(0, leadTimeStdDevDays);
  const demandDuringLeadTime = usage.avgDailyUsage * lt;

  // Safety stock over a variable lead time, combining BOTH sources of uncertainty:
  //   sqrt( LT x sigma_demand^2  +  (avgDemand x sigma_leadTime)^2 )
  // The second term is what makes an unreliable vendor cost more stock at the same
  // average speed — a slow vendor may run 15d +/- 5 while a fast one is 7.5d +/- 0.5.
  const demandVariance = lt * usage.stddevDaily ** 2;
  const leadTimeVariance = (usage.avgDailyUsage * ltSd) ** 2;
  const rawSafety = params.z * Math.sqrt(demandVariance + leadTimeVariance);

  const cap = demandDuringLeadTime * params.safetyCapMultiple;
  const safetyStockCapped = rawSafety > cap;
  const safetyStock = safetyStockCapped ? cap : rawSafety;

  return {
    minOnHand: roundUpToIncrement(demandDuringLeadTime + safetyStock),
    orderMin: roundUpToIncrement(usage.avgDailyUsage * params.coverageDays),
    demandDuringLeadTime,
    safetyStock,
    safetyStockCapped,
    leadTimeDays: lt,
  };
}

/**
 * Fit `z` and `coverageDays` to best reproduce the levels already set by hand.
 *
 * Fitted independently on a log scale (ratio error, so a part at 20 counts as much as
 * one at 20,000) via coarse-to-fine grid search — the search space is tiny and this
 * avoids pulling in a solver. `coverageDays` comes straight from OrderMin (it's the
 * only free parameter there); `z` is then fitted against MinOnHand.
 */
export type CalibrationSample = {
  usage: DemandInput;
  leadTimeDays: number;
  leadTimeStdDevDays: number;
  actualMinOnHand: number;
  actualOrderMin: number;
};

export type CalibrationResult = {
  params: LevelParams;
  sampleCount: number;
  /** Median predicted/actual ratio — 1.0 means we match the hand-set levels on average. */
  medianRatioMin: number;
  medianRatioOrder: number;
  /** Share of parts predicted within 2x of the hand-set value, either direction. */
  within2xMin: number;
  within2xOrder: number;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Mean squared error in log space, ignoring non-positive pairs. */
function logError(predicted: number[], actual: number[]): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < predicted.length; i += 1) {
    if (predicted[i] <= 0 || actual[i] <= 0) continue;
    sum += (Math.log(predicted[i] / actual[i])) ** 2;
    n += 1;
  }
  return n === 0 ? Number.POSITIVE_INFINITY : sum / n;
}

function gridSearch(
  lo: number,
  hi: number,
  steps: number,
  score: (candidate: number) => number,
): number {
  let best = lo;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= steps; i += 1) {
    const candidate = lo + ((hi - lo) * i) / steps;
    const s = score(candidate);
    if (s < bestScore) {
      bestScore = s;
      best = candidate;
    }
  }
  return best;
}

export function calibrate(samples: CalibrationSample[]): CalibrationResult | null {
  const usable = samples.filter(
    (s) => s.actualMinOnHand > 0 && s.actualOrderMin > 0 && s.usage.avgDailyUsage > 0,
  );
  if (usable.length < 10) return null;

  const actualOrder = usable.map((s) => s.actualOrderMin);
  const actualMin = usable.map((s) => s.actualMinOnHand);

  // Fixed policy, deliberately NOT fitted — see CALIBRATED_COVERAGE_DAYS for why
  // fitting it is degenerate (it just converges on the observation window).
  const coverageDays = CALIBRATED_COVERAGE_DAYS;

  // z and the safety cap are fitted together. They interact: once the cap binds it
  // pins MinOnHand at (1 + cap) x lead-time demand and z stops mattering, so fitting z
  // alone against a fixed cap can't reach the hand-set levels (they hold roughly a month, well
  // above 2x a 7-day lead time). Small grid, so just search the pair.
  const scoreMin = (z: number, safetyCapMultiple: number) =>
    logError(
      usable.map(
        (s) => computeLevels(s.usage, s.leadTimeDays, { z, coverageDays, safetyCapMultiple }, s.leadTimeStdDevDays).minOnHand,
      ),
      actualMin,
    );

  let bestZ = TEXTBOOK_PARAMS.z;
  let bestCap = TEXTBOOK_PARAMS.safetyCapMultiple;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let zi = 0; zi <= 40; zi += 1) {
    const z = (5 * zi) / 40;
    for (let ci = 0; ci <= 40; ci += 1) {
      const cap = (8 * ci) / 40;
      const s = scoreMin(z, cap);
      if (s < bestScore) {
        bestScore = s;
        bestZ = z;
        bestCap = cap;
      }
    }
  }
  // Refine around the winner.
  for (let zi = -10; zi <= 10; zi += 1) {
    for (let ci = -10; ci <= 10; ci += 1) {
      const z = Math.max(0, bestZ + zi * 0.02);
      const cap = Math.max(0, bestCap + ci * 0.04);
      const s = scoreMin(z, cap);
      if (s < bestScore) {
        bestScore = s;
        bestZ = z;
        bestCap = cap;
      }
    }
  }

  const params: LevelParams = {
    z: Math.round(bestZ * 100) / 100,
    coverageDays: Math.round(coverageDays * 10) / 10,
    safetyCapMultiple: Math.round(bestCap * 100) / 100,
  };

  const predictedMin = usable.map((s) => computeLevels(s.usage, s.leadTimeDays, params, s.leadTimeStdDevDays).minOnHand);
  const predictedOrder = usable.map((s) => computeLevels(s.usage, s.leadTimeDays, params, s.leadTimeStdDevDays).orderMin);
  const ratios = (p: number[], a: number[]) =>
    p.map((v, i) => (a[i] > 0 && v > 0 ? v / a[i] : NaN)).filter((v) => Number.isFinite(v));
  const ratioMin = ratios(predictedMin, actualMin);
  const ratioOrder = ratios(predictedOrder, actualOrder);
  const within2x = (rs: number[]) =>
    rs.length === 0 ? 0 : rs.filter((r) => r >= 0.5 && r <= 2).length / rs.length;

  return {
    params,
    sampleCount: usable.length,
    medianRatioMin: median(ratioMin),
    medianRatioOrder: median(ratioOrder),
    within2xMin: within2x(ratioMin),
    within2xOrder: within2x(ratioOrder),
  };
}
