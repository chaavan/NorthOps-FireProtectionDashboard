import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { buildPoLineKey } from '@/lib/poLineKey';

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
  const candidates: InventoryReorderCandidate[] = [];

  for (const part of parts) {
    const onHand = toNonNegativeInt(part.quantity);
    const minOnHand = toNonNegativeInt(part.reorderPoint);
    const orderMinimum = toNonNegativeInt(part.orderMinimum);
    if (minOnHand <= 0 || orderMinimum <= 0) continue;
    if (onHand > minOnHand) continue;

    const openPoQty = openPoByPart.get(inventoryPoLineKey(part.pn)) ?? 0;
    const remainingToOrder = remainingInventoryReorderQty({ orderMinimum, openPoQty });
    if (remainingToOrder <= 0) continue;

    candidates.push({
      partId: part.id,
      partNumber: part.pn,
      description: part.nomenclature,
      uom: part.units,
      vendor: part.vendor,
      onHand,
      minOnHand,
      orderMinimum,
      suggestedQty: orderMinimum,
      remainingToOrder,
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
      canCancel: false,
      cancelBlockReason: 'Inventory replenishment is automatic based on stock levels',
    })),
  };
}
