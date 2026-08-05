import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeSupplierKey } from "@/lib/suppliers";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Fallback when a vendor has too few measured samples to trust. Roughly the observed
 * average across vendors (most distributors sit near 7d; some run closer to 15d).
 */
export const DEFAULT_LEAD_TIME_DAYS = 7;

/** Below this, a vendor's own average is statistically meaningless — use the default. */
export const MIN_SAMPLES_FOR_VENDOR_AVERAGE = 3;

/** Guards against clock skew / bad data producing absurd averages. */
const MAX_PLAUSIBLE_LEAD_TIME_DAYS = 180;

/** normalizeSupplierKey returns this sentinel for blank/unknown suppliers. */
const UNASSIGNED_KEY = "UNASSIGNED";

function daysBetween(sentAt: Date, receivedAt: Date): number {
  return (receivedAt.getTime() - sentAt.getTime()) / 86_400_000;
}

export function isPlausibleLeadTime(days: number): boolean {
  return Number.isFinite(days) && days >= 0 && days <= MAX_PLAUSIBLE_LEAD_TIME_DAYS;
}

function usableVendorKey(value: string | null | undefined): string | null {
  const key = normalizeSupplierKey(value ?? "");
  if (!key || key === UNASSIGNED_KEY) return null;
  return key;
}

/**
 * Trimmed mean: drops the top and bottom decile once there are enough samples, so one
 * back-ordered PO (or a same-day "received" click on an old order) can't drag a
 * vendor's average around.
 */
export function trimmedMean(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  if (sorted.length < 5) {
    return sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  }
  const trim = Math.floor(sorted.length * 0.1);
  const kept = sorted.slice(trim, sorted.length - trim);
  const window = kept.length > 0 ? kept : sorted;
  return window.reduce((sum, v) => sum + v, 0) / window.length;
}

function roundDays(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

/**
 * Recompute a vendor's average from its samples and cache it onto the Vendor row.
 *
 * The cache is best-effort: the `vendors` master table only holds directory entries
 * for some suppliers (the Vendors list is a union of that table and distinct
 * parts.vendor values), so many suppliers have no row to write to. Samples remain the
 * source of truth — see getVendorLeadTimeMap.
 */
export async function recomputeVendorLeadTimeRollup(
  vendorKey: string,
  db: DbClient = prisma,
): Promise<{ avgLeadTimeDays: number | null; sampleCount: number }> {
  const key = usableVendorKey(vendorKey);
  if (!key) return { avgLeadTimeDays: null, sampleCount: 0 };

  const samples = await db.vendorLeadTimeSample.findMany({
    where: { vendorKey: key },
    select: { leadTimeDays: true },
  });
  const values = samples.map((s) => s.leadTimeDays).filter(isPlausibleLeadTime);
  const avg = roundDays(trimmedMean(values));

  await db.vendor.updateMany({
    where: { vendorKey: key },
    data: {
      avgLeadTimeDays: avg,
      leadTimeSampleCount: values.length,
      leadTimeUpdatedAt: new Date(),
    },
  });

  return { avgLeadTimeDays: avg, sampleCount: values.length };
}

/**
 * Record one order->receipt observation. Idempotent per (PO, part): receiving the same
 * line twice updates the existing sample rather than double-counting it.
 * Never throws — lead-time tracking must never be able to fail a receive.
 */
export async function recordLeadTimeSample(params: {
  vendorKey: string | null | undefined;
  purchaseOrderId: string;
  orderNumber?: string | null;
  partNumber: string;
  partId?: string | null;
  orderKind?: string | null;
  sentAt: Date;
  receivedAt?: Date;
  db?: DbClient;
}): Promise<void> {
  const db = params.db ?? prisma;
  try {
    const key = usableVendorKey(params.vendorKey);
    const partNumber = String(params.partNumber || "").trim();
    if (!key || !partNumber || !params.purchaseOrderId) return;

    const receivedAt = params.receivedAt ?? new Date();
    const leadTimeDays = daysBetween(params.sentAt, receivedAt);
    if (!isPlausibleLeadTime(leadTimeDays)) return;

    await db.vendorLeadTimeSample.upsert({
      where: {
        purchaseOrderId_partNumber: {
          purchaseOrderId: params.purchaseOrderId,
          partNumber,
        },
      },
      update: { receivedAt, leadTimeDays },
      create: {
        vendorKey: key,
        purchaseOrderId: params.purchaseOrderId,
        orderNumber: params.orderNumber ?? null,
        partNumber,
        partId: params.partId ?? null,
        orderKind: params.orderKind || "JOB",
        sentAt: params.sentAt,
        receivedAt,
        leadTimeDays,
      },
    });

    await recomputeVendorLeadTimeRollup(key, db);
  } catch (error) {
    console.error("recordLeadTimeSample failed (non-fatal):", error);
  }
}

/**
 * Drop samples for a PO (optionally just some parts) when a receive is reverted or
 * cancelled, so a mistaken click doesn't permanently skew the vendor's average.
 */
export async function voidLeadTimeSamples(params: {
  purchaseOrderId: string;
  partNumbers?: string[];
  db?: DbClient;
}): Promise<void> {
  const db = params.db ?? prisma;
  try {
    const where: Prisma.VendorLeadTimeSampleWhereInput = {
      purchaseOrderId: params.purchaseOrderId,
    };
    if (params.partNumbers && params.partNumbers.length > 0) {
      where.partNumber = { in: params.partNumbers.map((p) => String(p).trim()) };
    }
    const affected = await db.vendorLeadTimeSample.findMany({
      where,
      select: { vendorKey: true },
    });
    if (affected.length === 0) return;

    await db.vendorLeadTimeSample.deleteMany({ where });
    for (const key of new Set(affected.map((a) => a.vendorKey))) {
      await recomputeVendorLeadTimeRollup(key, db);
    }
  } catch (error) {
    console.error("voidLeadTimeSamples failed (non-fatal):", error);
  }
}

/**
 * Void samples for a job line when its receive is reverted, where the caller has no
 * PO id to hand (revert-received only knows job/list/part). Bounded: we start from the
 * samples for that part (few) and keep only those whose PO actually contains the line.
 */
export async function voidLeadTimeSamplesForJobLine(params: {
  jobNumber: string;
  partNumber: string;
  db?: DbClient;
}): Promise<void> {
  const db = params.db ?? prisma;
  try {
    const partNumber = String(params.partNumber || "").trim();
    const jobNumber = String(params.jobNumber || "").trim();
    if (!partNumber || !jobNumber) return;

    const candidates = await db.vendorLeadTimeSample.findMany({
      where: { partNumber },
      select: { id: true, vendorKey: true, purchaseOrderId: true },
    });
    if (candidates.length === 0) return;

    const orders = await db.purchaseOrder.findMany({
      where: { id: { in: [...new Set(candidates.map((c) => c.purchaseOrderId))] } },
      select: { id: true, items: true },
    });
    const ordersWithLine = new Set(
      orders
        .filter((po) => {
          const items = po.items as Array<{ jobNumber?: string; partNumber?: string }> | null;
          if (!Array.isArray(items)) return false;
          return items.some(
            (line) =>
              String(line.jobNumber ?? "").trim() === jobNumber &&
              String(line.partNumber ?? "").trim() === partNumber,
          );
        })
        .map((po) => po.id),
    );

    const doomed = candidates.filter((c) => ordersWithLine.has(c.purchaseOrderId));
    if (doomed.length === 0) return;

    await db.vendorLeadTimeSample.deleteMany({
      where: { id: { in: doomed.map((d) => d.id) } },
    });
    for (const key of new Set(doomed.map((d) => d.vendorKey))) {
      await recomputeVendorLeadTimeRollup(key, db);
    }
  } catch (error) {
    console.error("voidLeadTimeSamplesForJobLine failed (non-fatal):", error);
  }
}

export type VendorLeadTime = {
  vendorKey: string;
  days: number;
  /**
   * Sample stddev of this vendor's lead time. Reliability matters as much as speed:
   * A slow vendor may run 15d +/- 5 while a fast one is 7.5d +/- 0.5, and an unpredictable
   * vendor needs more safety stock at the same average. 0 when unmeasured.
   */
  stdDevDays: number;
  sampleCount: number;
  /** false => fell back to DEFAULT_LEAD_TIME_DAYS because the data is too thin. */
  measured: boolean;
};

function sampleStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1),
  );
}

function toLeadTime(key: string, values: number[]): VendorLeadTime {
  const usable = values.filter(isPlausibleLeadTime);
  const avg = roundDays(trimmedMean(usable));
  const measured = avg !== null && usable.length >= MIN_SAMPLES_FOR_VENDOR_AVERAGE;
  return {
    vendorKey: key,
    days: measured ? (avg as number) : DEFAULT_LEAD_TIME_DAYS,
    stdDevDays: measured ? Math.round(sampleStdDev(usable) * 10) / 10 : 0,
    sampleCount: usable.length,
    measured,
  };
}

/**
 * Lead time for every vendor that has samples, keyed by normalized supplier key.
 * Aggregated from samples (not the Vendor cache) so suppliers without a directory
 * row are covered too. One query — use this from the levels engine.
 */
export async function getVendorLeadTimeMap(
  db: DbClient = prisma,
): Promise<Map<string, VendorLeadTime>> {
  const map = new Map<string, VendorLeadTime>();
  try {
    const samples = await db.vendorLeadTimeSample.findMany({
      select: { vendorKey: true, leadTimeDays: true },
    });
    const byVendor = new Map<string, number[]>();
    for (const s of samples) {
      const list = byVendor.get(s.vendorKey);
      if (list) list.push(s.leadTimeDays);
      else byVendor.set(s.vendorKey, [s.leadTimeDays]);
    }
    for (const [key, values] of byVendor) {
      map.set(key, toLeadTime(key, values));
    }
  } catch {
    // Table not present yet (migration pending) — every vendor falls back to the
    // default, which is exactly what an empty map yields. Must not throw: this runs
    // on the To Order path.
  }
  return map;
}

/**
 * Derive lead times straight from the inventory ledger, without the sample table.
 *
 * Receiving an inventory PO writes a positive ORDER-context movement whose contextId
 * is the PO id; pairing the earliest one per (PO, part) with PurchaseOrder.sentAt
 * reconstructs the same observation the sample table stores. Used to seed the backfill
 * and to report before the migration has landed.
 */
export async function deriveLeadTimeMapFromLedger(
  db: DbClient = prisma,
): Promise<Map<string, VendorLeadTime>> {
  type Row = { supplier: string | null; lead_time_days: number };
  const rows = await db.$queryRawUnsafe<Row[]>(`
    WITH first_receipt AS (
      SELECT context_id AS po_id, part_id, MIN(created_at) AS received_at
      FROM inventory_movements
      WHERE context_type = 'ORDER' AND quantity_delta > 0 AND context_id IS NOT NULL
      GROUP BY context_id, part_id
    )
    SELECT po.supplier AS supplier,
           EXTRACT(EPOCH FROM (fr.received_at - po.sent_at)) / 86400 AS lead_time_days
    FROM first_receipt fr
    JOIN purchase_orders po ON po.id = fr.po_id
    WHERE po.sent_at IS NOT NULL AND fr.received_at >= po.sent_at
  `);

  const byVendor = new Map<string, number[]>();
  for (const row of rows) {
    const key = usableVendorKey(row.supplier);
    if (!key) continue;
    const days = Number(row.lead_time_days);
    if (!isPlausibleLeadTime(days)) continue;
    const list = byVendor.get(key);
    if (list) list.push(days);
    else byVendor.set(key, [days]);
  }

  const map = new Map<string, VendorLeadTime>();
  for (const [key, values] of byVendor) {
    map.set(key, toLeadTime(key, values));
  }
  return map;
}

/** Single-vendor lookup. Prefer getVendorLeadTimeMap when resolving many parts. */
export async function getVendorLeadTimeDays(
  vendorKey: string | null | undefined,
  db: DbClient = prisma,
): Promise<VendorLeadTime> {
  const key = usableVendorKey(vendorKey);
  if (!key) {
    return { vendorKey: "", days: DEFAULT_LEAD_TIME_DAYS, stdDevDays: 0, sampleCount: 0, measured: false };
  }
  try {
    const samples = await db.vendorLeadTimeSample.findMany({
      where: { vendorKey: key },
      select: { leadTimeDays: true },
    });
    return toLeadTime(key, samples.map((s) => s.leadTimeDays));
  } catch {
    // Migration pending — fall back to the default rather than throw.
    return { vendorKey: key, days: DEFAULT_LEAD_TIME_DAYS, stdDevDays: 0, sampleCount: 0, measured: false };
  }
}

/** Resolve from a prefetched map (unknown vendors fall back to the default). */
export function resolveLeadTimeFromMap(
  map: Map<string, VendorLeadTime>,
  vendor: string | null | undefined,
): VendorLeadTime {
  const key = usableVendorKey(vendor);
  if (!key) {
    return { vendorKey: "", days: DEFAULT_LEAD_TIME_DAYS, stdDevDays: 0, sampleCount: 0, measured: false };
  }
  return (
    map.get(key) ?? {
      vendorKey: key,
      days: DEFAULT_LEAD_TIME_DAYS,
      stdDevDays: 0,
      sampleCount: 0,
      measured: false,
    }
  );
}
