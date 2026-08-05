import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { buildPoLineKey } from '@/lib/poLineKey';
import { isDynamicReorderEnabled } from '@/lib/featureFlags';

export const INVENTORY_REORDER_JOB_NUMBER = 'INVENTORY';
export const INVENTORY_REORDER_LIST_NUMBER = 'STOCK';
export const INVENTORY_REORDER_JOB_NAME = 'Inventory Replenishment';
export const INVENTORY_REORDER_REASON = 'NEEDS_MINIMUM';

type DbClient = PrismaClient | Prisma.TransactionClient;

export type InventoryReorderCandidate = {
  partId: string;
  partNumber: string;
  description: string | null;
  uom: string | null;
  vendor: string | null;
  onHand: number;
  minOnHand: number;
  orderMinimum: number;
  suggestedQty: number;
  remainingToOrder: number;
  openPoQty: number;
};

export type InventoryPoLineItem = {
  jobNumber?: string | null;
  listNumber?: string | null;
  partNumber?: string | null;
  description?: string | null;
  quantityOrdered?: number;
  quantityReceived?: number;
  cancelled?: boolean;
  fullyReceived?: boolean;
  partId?: string | null;
};

export function isInventoryReplenishmentJobNumber(jobNumber: string | null | undefined): boolean {
  return String(jobNumber ?? '').trim().toUpperCase() === INVENTORY_REORDER_JOB_NUMBER;
}

export function inventoryPoLineKey(partNumber: string): string {
  return buildPoLineKey(
    INVENTORY_REORDER_JOB_NUMBER,
    INVENTORY_REORDER_LIST_NUMBER,
    partNumber,
  );
}

export function hasReorderThresholds(part: {
  reorderPoint: number | null | undefined;
  orderMinimum: number | null | undefined;
}): boolean {
  const minOnHand = Number(part.reorderPoint ?? 0);
  const orderMinimum = Number(part.orderMinimum ?? 0);
  return Number.isFinite(minOnHand) && minOnHand > 0 && Number.isFinite(orderMinimum) && orderMinimum > 0;
}

export function isBelowMinimumOnHand(part: {
  quantity: number | null | undefined;
  reorderPoint: number | null | undefined;
  orderMinimum?: number | null | undefined;
}): boolean {
  if (!hasReorderThresholds({ reorderPoint: part.reorderPoint, orderMinimum: part.orderMinimum })) {
    return false;
  }
  const onHand = Math.max(0, Number(part.quantity ?? 0));
  const minOnHand = Number(part.reorderPoint ?? 0);
  return onHand <= minOnHand;
}

export function getSuggestedReorderQty(part: {
  orderMinimum: number | null | undefined;
}): number {
  return Math.max(0, Number(part.orderMinimum ?? 0));
}

export function remainingInventoryReorderQty(params: {
  orderMinimum: number;
  openPoQty: number;
}): number {
  const suggested = Math.max(0, params.orderMinimum);
  const openQty = Math.max(0, params.openPoQty);
  return Math.max(0, suggested - openQty);
}

/**
 * Committed-but-unfulfilled demand on jobs that haven't been delivered yet: units a
 * live job still needs after FAB, shop pulls and vendor receipts.
 *
 * Everything else feeding the suggestion is historical. This is the only
 * forward-looking signal — it's what stops us suggesting nothing while a job next week
 * still needs 500 of a part.
 *
 * Lives here rather than in lib/inventoryLevels/usage.ts because that module is
 * "server-only" and this one is reachable from the client bundle.
 */
export async function getOpenJobDemand(db: DbClient = prisma): Promise<Map<string, number>> {
  const rows = await db.$queryRaw<Array<{ part_number: string; units: number }>>`
    SELECT part_number,
           SUM(GREATEST(
             quantity_needed
               - COALESCE(quantity_fab, 0)
               - COALESCE(pulled, 0)
               - COALESCE(quantity_received_from_order, 0), 0))::int AS units
    FROM jobs
    WHERE COALESCE(delivered, false) = false
    GROUP BY part_number
    HAVING SUM(GREATEST(
             quantity_needed
               - COALESCE(quantity_fab, 0)
               - COALESCE(pulled, 0)
               - COALESCE(quantity_received_from_order, 0), 0)) > 0
  `;
  const map = new Map<string, number>();
  for (const row of rows) {
    const pn = String(row.part_number ?? '').trim().toUpperCase();
    if (!pn) continue;
    map.set(pn, (map.get(pn) ?? 0) + Math.max(0, Number(row.units) || 0));
  }
  return map;
}

export type ReorderSuggestion = {
  /** Units to put on the next order. 0 means the part shouldn't appear in To Order. */
  suggestedQty: number;
  /** onHand + everything already on an open PO — what we'll have once orders land. */
  inventoryPosition: number;
  /** The level we're topping back up to (only meaningful in dynamic mode). */
  targetLevel: number;
};

/**
 * How much of an inventory part to order.
 *
 * Static mode (default): suggest the flat Order Min, less whatever is already on an
 * open PO. Simple, and what purchasing is used to.
 *
 * Dynamic mode (NEXT_PUBLIC_ENABLE_DYNAMIC_REORDER=true): a classic order-up-to (s,S)
 * policy driven by the usage-derived levels —
 *
 *   s = minOnHand                          reorder when position drops to/below this
 *   S = minOnHand + orderMinimum           top back up to this
 *   position = onHand + openPoQty - openJobDemand
 *   suggestedQty = S - position
 *
 * Two improvements over static. It accounts for HOW FAR below the reorder point stock
 * has fallen — a part at 2 when the minimum is 50 gets more than one at 49 — and it
 * subtracts stock that live jobs have already claimed, so the shelf can't look full
 * while 500 units are spoken for by a job next week.
 *
 * Both modes drive the suggestion off inventory position, so once an order covering the
 * need is sent the part drops off To Order and lives on On Order until it's received.
 * That lifecycle is what the client asked for and both modes preserve it.
 */
export function getInventoryReorderSuggestion(params: {
  onHand: number;
  minOnHand: number;
  orderMinimum: number;
  openPoQty: number;
  /** Units already committed to undelivered jobs — stock that is spoken for. */
  openJobDemand?: number;
  dynamic: boolean;
}): ReorderSuggestion {
  const onHand = Math.max(0, params.onHand);
  const minOnHand = Math.max(0, params.minOnHand);
  const orderMinimum = Math.max(0, params.orderMinimum);
  const openPoQty = Math.max(0, params.openPoQty);
  const openJobDemand = Math.max(0, params.openJobDemand ?? 0);
  const targetLevel = minOnHand + orderMinimum;

  if (!params.dynamic) {
    // Static: trigger on stock alone, then net out what's already coming. Committed
    // job demand is ignored, matching the behaviour purchasing has today.
    const inventoryPosition = onHand + openPoQty;
    if (onHand > minOnHand) {
      return { suggestedQty: 0, inventoryPosition, targetLevel };
    }
    return {
      suggestedQty: remainingInventoryReorderQty({ orderMinimum, openPoQty }),
      inventoryPosition,
      targetLevel,
    };
  }

  // Dynamic: work from available-to-promise — what's on the shelf, plus what's on
  // order, minus what live jobs have already claimed. Without the last term the shelf
  // looks full while 500 units are already spoken for by a job next week.
  const inventoryPosition = onHand + openPoQty - openJobDemand;
  if (inventoryPosition > minOnHand) {
    return { suggestedQty: 0, inventoryPosition, targetLevel };
  }
  return {
    suggestedQty: Math.max(0, targetLevel - inventoryPosition),
    inventoryPosition,
    targetLevel,
  };
}

function toNonNegativeInt(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export function getInventoryPoOutstandingQty(
  poItems: InventoryPoLineItem[],
): Map<string, number> {
  const outstanding = new Map<string, number>();

  for (const item of poItems) {
    if (item.cancelled === true) continue;

    const partNumber = String(item.partNumber ?? '').trim();
    if (!partNumber) continue;

    const ordered = toNonNegativeInt(item.quantityOrdered);
    const received = toNonNegativeInt(item.quantityReceived);
    const remaining = ordered > 0 ? Math.max(0, ordered - received) : 0;
    if (remaining <= 0) continue;

    const key = inventoryPoLineKey(partNumber);
    outstanding.set(key, (outstanding.get(key) ?? 0) + remaining);
  }

  return outstanding;
}

export async function loadInventoryPoOutstandingQty(
  db: DbClient = prisma,
): Promise<Map<string, number>> {
  const orders = await db.purchaseOrder.findMany({
    select: {
      items: true,
      orderKind: true,
    },
  });

  const allItems: InventoryPoLineItem[] = [];
  for (const order of orders) {
    if (!Array.isArray(order.items)) continue;
    for (const raw of order.items as InventoryPoLineItem[]) {
      if (order.orderKind === 'INVENTORY' || isInventoryReplenishmentJobNumber(raw.jobNumber)) {
        allItems.push(raw);
      }
    }
  }

  return getInventoryPoOutstandingQty(allItems);
}

/**
 * Returns the ids of parts a user has snoozed (dismissed) from auto-reorder, after
 * re-arming any that have recovered above their reorder point. Wrapped in try/catch so
 * the To Order tab still loads if the `reorder_snoozed_at` migration hasn't been applied
 * yet (the snooze feature is simply inert until then).
 */
export async function loadSnoozedReorderPartIds(
  db: DbClient = prisma,
): Promise<Set<string>> {
  try {
    const snoozed = await db.part.findMany({
      where: { reorderSnoozedAt: { not: null } },
      select: { id: true, quantity: true, reorderPoint: true },
    });
    if (snoozed.length === 0) return new Set();

    // Re-arm parts that have been restocked back above their reorder point so a future
    // dip re-suggests them; keep the rest suppressed.
    const rearmIds: string[] = [];
    const stillSnoozed = new Set<string>();
    for (const part of snoozed) {
      const onHand = Number(part.quantity ?? 0);
      const minOnHand = Number(part.reorderPoint ?? 0);
      if (minOnHand > 0 && onHand > minOnHand) {
        rearmIds.push(part.id);
      } else {
        stillSnoozed.add(part.id);
      }
    }
    if (rearmIds.length > 0) {
      await db.part.updateMany({
        where: { id: { in: rearmIds } },
        data: { reorderSnoozedAt: null },
      });
    }
    return stillSnoozed;
  } catch {
    // Column not present yet (migration pending) — treat nothing as snoozed.
    return new Set();
  }
}

export async function listPartsNeedingReorder(
  db: DbClient = prisma,
): Promise<InventoryReorderCandidate[]> {
  const parts = await db.part.findMany({
    where: {
      pn: { not: '' },
      reorderPoint: { gt: 0 },
      orderMinimum: { gt: 0 },
    },
    select: {
      id: true,
      pn: true,
      nomenclature: true,
      units: true,
      vendor: true,
      quantity: true,
      reorderPoint: true,
      orderMinimum: true,
    },
    orderBy: [{ pn: 'asc' }],
  });

  const openPoByPart = await loadInventoryPoOutstandingQty(db);
  const snoozedPartIds = await loadSnoozedReorderPartIds(db);
  const dynamic = isDynamicReorderEnabled();
  // Only the dynamic policy consumes committed job demand; skip the query otherwise.
  const openJobDemand = dynamic ? await getOpenJobDemand(db) : new Map<string, number>();
  const candidates: InventoryReorderCandidate[] = [];

  for (const part of parts) {
    // Skip parts the user dismissed ("cancelled") from the To Order tab. They stay
    // suppressed until stock recovers above the reorder point (see loadSnoozedReorderPartIds).
    if (snoozedPartIds.has(part.id)) continue;

    const onHand = toNonNegativeInt(part.quantity);
    const minOnHand = toNonNegativeInt(part.reorderPoint);
    const orderMinimum = toNonNegativeInt(part.orderMinimum);
    if (minOnHand <= 0 || orderMinimum <= 0) continue;

    const openPoQty = openPoByPart.get(inventoryPoLineKey(part.pn)) ?? 0;
    const suggestion = getInventoryReorderSuggestion({
      onHand,
      minOnHand,
      orderMinimum,
      openPoQty,
      openJobDemand: openJobDemand.get(part.pn.trim().toUpperCase()) ?? 0,
      dynamic,
    });
    // 0 => either stock is above the reorder point, or an open PO already covers the
    // need. Either way the part belongs on "On Order", not here.
    if (suggestion.suggestedQty <= 0) continue;

    candidates.push({
      partId: part.id,
      partNumber: part.pn,
      description: part.nomenclature,
      uom: part.units,
      vendor: part.vendor,
      onHand,
      minOnHand,
      orderMinimum,
      suggestedQty: suggestion.suggestedQty,
      remainingToOrder: suggestion.suggestedQty,
      openPoQty,
    });
  }

  return candidates;
}

export function buildInventoryPendingToOrderGroup(
  candidates: InventoryReorderCandidate[],
): {
  jobNumber: string;
  jobName: string;
  area: null;
  isInventoryReplenishment: true;
  items: Array<{
    listNumber: string;
    partNumber: string;
    description: string | null;
    uom: string | null;
    quantityOrdered: number;
    quantityNeeded: number;
    quantityFab: number;
    quantityPulled: number;
    quantityPreordered: number;
    quantityReceivedFromOrder: number;
    remainingToOrder: number;
    vendor: string | null;
    reorderReason: typeof INVENTORY_REORDER_REASON;
    onHand: number;
    minOnHand: number;
    orderMinimum: number;
    isInPurchaseOrder: boolean;
    canCancel: boolean;
  }>;
} | null {
  if (candidates.length === 0) return null;

  return {
    jobNumber: INVENTORY_REORDER_JOB_NUMBER,
    jobName: INVENTORY_REORDER_JOB_NAME,
    area: null,
    isInventoryReplenishment: true,
    items: candidates.map((candidate) => ({
      listNumber: INVENTORY_REORDER_LIST_NUMBER,
      partNumber: candidate.partNumber,
      description: candidate.description,
      uom: candidate.uom,
      quantityOrdered: candidate.remainingToOrder,
      quantityNeeded: 0,
      quantityFab: 0,
      quantityPulled: 0,
      quantityPreordered: 0,
      quantityReceivedFromOrder: 0,
      remainingToOrder: candidate.remainingToOrder,
      vendor: candidate.vendor,
      reorderReason: INVENTORY_REORDER_REASON,
      onHand: candidate.onHand,
      minOnHand: candidate.minOnHand,
      orderMinimum: candidate.orderMinimum,
      isInPurchaseOrder: candidate.openPoQty > 0,
      // Inventory suggestions can be dismissed from the To Order tab; cancelling snoozes
      // the part (Part.reorderSnoozedAt) until stock recovers above its reorder point.
      canCancel: true,
    })),
  };
}
