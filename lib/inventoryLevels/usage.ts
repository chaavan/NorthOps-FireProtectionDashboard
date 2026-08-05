import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * When this dashboard's inventory data became real.
 *
 * The ledger starts 2026-01-18, but the early rows are setup/test: the first two weeks
 * of job activity cover 1 and 3 jobs respectively, then the week of 2026-02-23 jumps to
 * 27 jobs / 145 parts / 340 movements and never drops below ~30 jobs a week again.
 * Everything before this date would drag the averages down with test noise.
 *
 * We deliberately use EVERY day from here to now rather than a rolling window, so the
 * estimates keep improving as more history accumulates.
 */
export const INVENTORY_DATA_START = new Date("2026-02-23T00:00:00Z");

/** Average days per month, for converting monthly variability to daily. */
const DAYS_PER_MONTH = 30.44;

/** Whole days of observed history from `since` to now (minimum 1). */
export function usageWindowDays(since: Date = INVENTORY_DATA_START): number {
  const days = (Date.now() - since.getTime()) / 86_400_000;
  return Math.max(1, Math.round(days));
}

export type MonthlyUsage = { month: string; used: number };

export type PartUsageStats = {
  partId: string;
  /** Net units consumed over the window (pulls minus returns). Never negative. */
  totalUsed: number;
  /** Distinct calendar months with any net movement — our confidence signal. */
  activeMonths: number;
  avgDailyUsage: number;
  avgMonthlyUsage: number;
  /** Sample stddev of monthly usage; 0 when there are fewer than 2 months. */
  stddevMonthly: number;
  /** Monthly stddev converted to a daily figure for the reorder-point formula. */
  stddevDaily: number;
  monthly: MonthlyUsage[];
  firstSeen: Date | null;
  lastSeen: Date | null;
  windowDays: number;
};

type MonthRow = {
  part_id: string;
  month: Date;
  net: number;
  first_seen: Date;
  last_seen: Date;
};

function sampleStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Net job consumption per part over a rolling window.
 *
 * Reads only `context_type='JOB'` movements and sums the SIGNED delta. This matters:
 *  - PULL rows are negative (stock leaving for a job) and UNPULL rows are positive
 *    (returns / stock-backs / reversals), so summing signed deltas nets returns out
 *    automatically — they must not be subtracted a second time.
 *  - Filtering on `type` instead of `context_type` would be wrong: PO receipts are
 *    also UNPULL rows (ORDER context) and would be counted as consumption with the
 *    wrong sign. MANUAL adjustments are corrections, not usage, and are excluded too.
 */
export async function getPartUsageStats(
  since: Date = INVENTORY_DATA_START,
  db: DbClient = prisma,
): Promise<Map<string, PartUsageStats>> {
  const windowDays = usageWindowDays(since);
  const rows = await db.$queryRaw<MonthRow[]>`
    SELECT
      part_id,
      date_trunc('month', created_at) AS month,
      (-SUM(quantity_delta))::int      AS net,
      MIN(created_at)                  AS first_seen,
      MAX(created_at)                  AS last_seen
    FROM inventory_movements
    WHERE context_type = 'JOB'
      AND created_at >= ${since}
    GROUP BY part_id, date_trunc('month', created_at)
  `;

  const byPart = new Map<string, MonthRow[]>();
  for (const row of rows) {
    const list = byPart.get(row.part_id);
    if (list) list.push(row);
    else byPart.set(row.part_id, [row]);
  }

  const stats = new Map<string, PartUsageStats>();
  for (const [partId, monthRows] of byPart) {
    const sorted = [...monthRows].sort(
      (a, b) => new Date(a.month).getTime() - new Date(b.month).getTime(),
    );

    // A month can net negative when a return lands after the pull it reverses; clamp
    // per-month so one late stock-back can't read as "negative demand".
    const monthly: MonthlyUsage[] = sorted.map((r) => ({
      month: new Date(r.month).toISOString().slice(0, 7),
      used: Math.max(0, Number(r.net) || 0),
    }));

    const totalUsed = Math.max(
      0,
      sorted.reduce((sum, r) => sum + (Number(r.net) || 0), 0),
    );
    // Months with zero net movement still count as observed demand history, but a
    // month that only contained a return is not an "active" month.
    const activeMonths = monthly.filter((m) => m.used > 0).length;
    const monthlyValues = monthly.map((m) => m.used);
    const avgMonthlyUsage =
      monthlyValues.length > 0
        ? monthlyValues.reduce((s, v) => s + v, 0) / monthlyValues.length
        : 0;
    const stddevMonthly = sampleStdDev(monthlyValues);

    const firstSeen = sorted.length > 0 ? new Date(sorted[0].first_seen) : null;
    const lastSeen =
      sorted.length > 0 ? new Date(sorted[sorted.length - 1].last_seen) : null;

    stats.set(partId, {
      partId,
      totalUsed,
      activeMonths,
      avgDailyUsage: totalUsed / windowDays,
      avgMonthlyUsage,
      stddevMonthly,
      stddevDaily: stddevMonthly / Math.sqrt(DAYS_PER_MONTH),
      monthly,
      firstSeen,
      lastSeen,
      windowDays,
    });
  }

  return stats;
}

/**
 * Placeholder part numbers used for one-off custom buys. They dominate job-PO counts
 * (CUSTOMORDER alone appears on 146 lines) but aren't a real part, so they must never
 * be treated as a stocking candidate.
 */
export function isPlaceholderPartNumber(pn: string): boolean {
  return /^CUSTOMORDER/i.test(pn.trim());
}

export type JobOrderDemand = {
  /** Units ordered for jobs over the window — real demand, just bought per job. */
  totalQty: number;
  /** How many PO lines it appeared on — the "I keep ordering this" signal. */
  lineCount: number;
  /** Distinct jobs that needed it — breadth, not just one big job. */
  distinctJobs: number;
  /** Units ordered per YYYY-MM, so variability is measurable for these parts too. */
  monthly: Map<string, number>;
};

/**
 * What jobs BOUGHT of each part, from job purchase orders.
 *
 * This is the other half of demand. Material on a job PO ships to the job and never
 * enters stock, so it produces no inventory movement — a part bought per job looks
 * like it has ZERO usage in the ledger even when every job needs it. Counting the
 * ordered quantity is what makes those parts visible as stocking candidates.
 *
 * No double-count risk: job PO receipts don't touch Part.quantity (only INVENTORY POs
 * write ORDER-context movements), so a unit is either pulled from stock or bought on a
 * job PO, never both.
 */
export async function getJobOrderDemand(
  since: Date = INVENTORY_DATA_START,
  db: DbClient = prisma,
): Promise<Map<string, JobOrderDemand>> {
  const orders = await db.purchaseOrder.findMany({
    where: { sentAt: { gte: since } },
    select: { items: true, orderKind: true, sentAt: true },
  });

  const byPart = new Map<
    string,
    { totalQty: number; lineCount: number; jobs: Set<string>; monthly: Map<string, number> }
  >();
  for (const order of orders) {
    if (order.orderKind === "INVENTORY") continue;
    const items = order.items as Array<{
      partNumber?: string;
      jobNumber?: string;
      quantityOrdered?: number;
      cancelled?: boolean;
    }> | null;
    if (!Array.isArray(items)) continue;
    const month = order.sentAt.toISOString().slice(0, 7);
    for (const item of items) {
      if (item.cancelled === true) continue;
      const pn = String(item.partNumber ?? "").trim().toUpperCase();
      if (!pn || isPlaceholderPartNumber(pn)) continue;
      const qty = Math.max(0, Number(item.quantityOrdered) || 0);
      const entry =
        byPart.get(pn) ??
        { totalQty: 0, lineCount: 0, jobs: new Set<string>(), monthly: new Map<string, number>() };
      entry.totalQty += qty;
      entry.lineCount += 1;
      entry.jobs.add(String(item.jobNumber ?? "").trim());
      entry.monthly.set(month, (entry.monthly.get(month) ?? 0) + qty);
      byPart.set(pn, entry);
    }
  }

  const out = new Map<string, JobOrderDemand>();
  for (const [pn, e] of byPart) {
    out.set(pn, {
      totalQty: e.totalQty,
      lineCount: e.lineCount,
      distinctJobs: e.jobs.size,
      monthly: e.monthly,
    });
  }
  return out;
}

export type PartDemand = {
  partId: string;
  partNumber: string;
  /** Units pulled from stock (inventory ledger). */
  stockUsed: number;
  /** Units bought straight onto jobs (job POs). */
  orderedQty: number;
  /** stockUsed + orderedQty — what jobs consumed, however it was sourced. */
  totalDemand: number;
  /** Distinct months with demand from either stream. */
  activeMonths: number;
  orderLineCount: number;
  distinctJobs: number;
  avgDailyDemand: number;
  /** Daily stddev of the COMBINED monthly series. */
  stddevDaily: number;
  /**
   * Sizing basis for Min On Hand / Order Min: STOCK PULLS ONLY.
   *
   * Job-PO buys ship straight to the job and never cycle through the shelf, so they
   * must not size stock levels — including them makes a part that's mostly bought
   * per-job demand a 4-month shelf it never actually pulls from. The combined
   * `avgDailyDemand`/`stddevDaily`/`totalDemand` above stay job-PO-inclusive because
   * that's the right signal for WHETHER to stock a part (classification), just not for
   * HOW MUCH.
   */
  sizingAvgDaily: number;
  /** Pull-only daily stddev, for safety stock. */
  sizingStddevDaily: number;
  windowDays: number;
};

/**
 * Merge the two demand streams into one view per part.
 *
 * Stocked parts show up as stock pulls; parts bought per job show up as job-PO
 * quantities and would otherwise read as zero demand. Adding them is what lets a part
 * that's ordered 21 times across 13 jobs be recognised as a stocking candidate.
 */
export function buildPartDemand(params: {
  parts: Array<{ id: string; pn: string }>;
  usage: Map<string, PartUsageStats>;
  jobOrders: Map<string, JobOrderDemand>;
  windowDays: number;
}): Map<string, PartDemand> {
  const out = new Map<string, PartDemand>();
  for (const part of params.parts) {
    const pnKey = part.pn.trim().toUpperCase();
    if (!pnKey || isPlaceholderPartNumber(pnKey)) continue;
    const usage = params.usage.get(part.id);
    const orders = params.jobOrders.get(pnKey);
    if (!usage && !orders) continue;

    // Combine the monthly series so variability reflects both streams.
    const monthly = new Map<string, number>();
    for (const m of usage?.monthly ?? []) {
      monthly.set(m.month, (monthly.get(m.month) ?? 0) + m.used);
    }
    for (const [month, qty] of orders?.monthly ?? []) {
      monthly.set(month, (monthly.get(month) ?? 0) + qty);
    }

    const values = [...monthly.values()];
    const stockUsed = usage?.totalUsed ?? 0;
    const orderedQty = orders?.totalQty ?? 0;
    const totalDemand = stockUsed + orderedQty;

    out.set(part.id, {
      partId: part.id,
      partNumber: part.pn,
      stockUsed,
      orderedQty,
      totalDemand,
      activeMonths: values.filter((v) => v > 0).length,
      orderLineCount: orders?.lineCount ?? 0,
      distinctJobs: orders?.distinctJobs ?? 0,
      avgDailyDemand: totalDemand / params.windowDays,
      stddevDaily: sampleStdDev(values) / Math.sqrt(DAYS_PER_MONTH),
      // Pull-only: sized from what actually leaves the shelf, not job-PO buys.
      sizingAvgDaily: (usage?.totalUsed ?? 0) / params.windowDays,
      sizingStddevDaily: usage?.stddevDaily ?? 0,
      windowDays: params.windowDays,
    });
  }
  return out;
}

