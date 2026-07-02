import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { MovementType } from '@prisma/client';
import { authOptions, resolveSessionUserIdForAudit } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { cache, cacheKeys } from '@/lib/cache';
import { getRemainingQty } from '@/lib/quantityMath';
import {
  INVENTORY_REORDER_LIST_NUMBER,
  isInventoryReplenishmentJobNumber,
  type InventoryPoLineItem,
} from '@/lib/inventoryReorder';
import { ORDER_CONTEXT_TYPE, recordOperationalDelta } from '@/lib/inventoryLedger';
import { partNumberLookupVariants } from '@/lib/inventoryQuantity';
import { findPartRowByLookupVariants } from '@/lib/partsDatabase';
import { requirePermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

interface ItemToMark {
  jobNumber: string;
  listNumber?: string | null;
  partNumber: string;
  quantityReceived?: number | null;
  orderId?: string | null;
}

function toNonNegativeInt(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

async function markInventoryItemsReceived(
  items: Array<{
    jobNumber: string;
    listNumber: string | null;
    partNumber: string;
    quantityReceived?: number | null;
    orderId?: string | null;
  }>,
  actorUserId: string | null,
): Promise<number> {
  if (items.length === 0) return 0;

  let updatedCount = 0;
  await prisma.$transaction(async (tx) => {
    const purchaseOrders = await tx.purchaseOrder.findMany({
      select: { id: true, orderNumber: true, items: true, orderKind: true },
    });

    const inventoryPurchaseOrders = purchaseOrders.filter((po) => {
      if (po.orderKind === 'INVENTORY') return true;
      const poItems = (po.items ?? []) as InventoryPoLineItem[];
      return Array.isArray(poItems) && poItems.some(
        (line) => isInventoryReplenishmentJobNumber(line.jobNumber),
      );
    });

    for (const item of items) {
      const partNumber = item.partNumber.trim();
      if (!partNumber) continue;

      const scopedOrderId = item.orderId?.trim() || null;
      const purchaseOrdersToUpdate = scopedOrderId
        ? inventoryPurchaseOrders.filter((po) => po.id === scopedOrderId)
        : inventoryPurchaseOrders;

      for (const po of purchaseOrdersToUpdate) {
        const poItems = (po.items ?? []) as InventoryPoLineItem[];
        if (!Array.isArray(poItems)) continue;

        let lineUpdated = false;
        const nextItems: InventoryPoLineItem[] = [];
        for (const poItem of poItems) {
          if (poItem.cancelled === true) {
            nextItems.push(poItem);
            continue;
          }
          const poPartNumber = String(poItem.partNumber ?? '').trim();
          if (poPartNumber !== partNumber) {
            nextItems.push(poItem);
            continue;
          }
          if (
            po.orderKind !== 'INVENTORY' &&
            !isInventoryReplenishmentJobNumber(poItem.jobNumber)
          ) {
            nextItems.push(poItem);
            continue;
          }

          const ordered = toNonNegativeInt(poItem.quantityOrdered);
          const priorReceived = toNonNegativeInt(poItem.quantityReceived);
          let newReceived = priorReceived;
          if (item.quantityReceived !== undefined && item.quantityReceived !== null) {
            newReceived = toNonNegativeInt(item.quantityReceived);
          } else {
            newReceived = ordered;
          }
          if (newReceived > ordered) {
            newReceived = ordered;
          }

          const delta = newReceived - priorReceived;
          if (delta > 0) {
            const part =
              poItem.partId
                ? await tx.part.findUnique({ where: { id: poItem.partId } })
                : await findPartRowByLookupVariants(
                    partNumberLookupVariants(partNumber),
                    tx,
                  );
            if (!part) {
              throw new Error(`Part not found for inventory receive: ${partNumber}`);
            }
            await recordOperationalDelta(tx, {
              partId: part.id,
              signedDelta: delta,
              movementType: MovementType.UNPULL,
              contextType: ORDER_CONTEXT_TYPE,
              contextId: po.id,
              actorUserId,
              note: `Inventory PO receive | PO ${po.orderNumber}`,
            });
          }

          lineUpdated = true;
          nextItems.push({
            ...poItem,
            jobNumber: poItem.jobNumber ?? item.jobNumber,
            listNumber: poItem.listNumber ?? item.listNumber ?? INVENTORY_REORDER_LIST_NUMBER,
            quantityReceived: newReceived,
            fullyReceived: ordered > 0 && newReceived >= ordered,
          });
        }

        if (lineUpdated) {
          await tx.purchaseOrder.update({
            where: { id: po.id },
            data: { items: nextItems },
          });
          updatedCount += 1;
        }
      }
    }
  });

  return updatedCount;
}

/**
 * POST /api/admin/orders/mark-received
 * Marks items as received by setting receivedFromOrder=true
 * Accepts array of { jobNumber, listNumber, partNumber } pairs
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const auth = await requirePermission(session, 'orders.mark_received');
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const { items } = body as { items: ItemToMark[] };

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'No items provided' },
        { status: 400 }
      );
    }

    // Validate items structure
    for (const item of items) {
      if (!item.jobNumber || !item.partNumber) {
        return NextResponse.json(
          { error: 'Each item must have jobNumber and partNumber' },
          { status: 400 }
        );
      }
    }

    const normalizedItems = items.map(item => ({
      jobNumber: item.jobNumber.trim(),
      listNumber: item.listNumber?.trim() || null,
      partNumber: item.partNumber.trim(),
      quantityReceived: item.quantityReceived,
      orderId: item.orderId?.trim() || null,
    }));

    const inventoryItems = normalizedItems.filter((item) =>
      isInventoryReplenishmentJobNumber(item.jobNumber),
    );
    const jobItems = normalizedItems.filter(
      (item) => !isInventoryReplenishmentJobNumber(item.jobNumber),
    );

    const actorUserId = await resolveSessionUserIdForAudit(session);
    let totalUpdated = 0;

    if (inventoryItems.length > 0) {
      const inventoryUpdated = await markInventoryItemsReceived(inventoryItems, actorUserId);
      if (inventoryUpdated === 0) {
        return NextResponse.json(
          { error: 'No inventory purchase order lines were updated. Refresh and try again.' },
          { status: 409 },
        );
      }
      totalUpdated += inventoryUpdated;
    }

    if (jobItems.length === 0) {
      return NextResponse.json({
        success: true,
        updatedCount: totalUpdated,
        itemCount: items.length,
      });
    }

    const currentRecords = await prisma.job.findMany({
      where: {
        OR: jobItems.map((item) => (
          item.listNumber
            ? {
                jobNumber: item.jobNumber,
                listNumber: item.listNumber,
                partNumber: item.partNumber,
              }
            : {
                jobNumber: item.jobNumber,
                partNumber: item.partNumber,
              }
        )),
      },
    });

    // Create a map for quick lookup
    const recordMap = new Map<string, (typeof currentRecords)[number]>();
    currentRecords.forEach(record => {
      const compositeKey = `${record.jobNumber}::${record.listNumber}::${record.partNumber}`;
      const legacyKey = `${record.jobNumber}::::${record.partNumber}`;
      recordMap.set(compositeKey, record);
      if (!recordMap.has(legacyKey)) {
        recordMap.set(legacyKey, record);
      }
    });
    // Update each item to mark as received and set quantityReceivedFromOrder
    const updatePromises = jobItems.map((item) => {
      const compositeKey = `${item.jobNumber}::${item.listNumber ?? ''}::${item.partNumber}`;
      const legacyKey = `${item.jobNumber}::::${item.partNumber}`;
      const key = item.listNumber ? compositeKey : legacyKey;
      const currentRecord = recordMap.get(key);

      if (!currentRecord) {
        throw new Error(`Job line not found: ${item.jobNumber} ${item.listNumber ? `(list ${item.listNumber}) ` : ''}${item.partNumber}`);
      }
      
      // Use provided quantityReceived, or fall back to quantityOrdered, or remaining quantity
      let quantityReceivedFromOrder: number;
      if (item.quantityReceived !== undefined && item.quantityReceived !== null) {
        // Validate that quantityReceived is a positive number
        const qty = Number(item.quantityReceived);
        if (isNaN(qty) || qty < 0) {
          throw new Error(`Invalid quantity received for ${item.jobNumber}::${currentRecord.listNumber}::${item.partNumber}: must be a non-negative number`);
        }
        // Use the provided quantity (this is the total received, not incremental)
        quantityReceivedFromOrder = qty;
      } else {
        // FAB-aware fallback: complete current remaining without reducing existing received totals.
        const quantityNeeded = currentRecord?.quantityNeeded ?? 0;
        const quantityFab = currentRecord?.quantityFab ?? 0;
        const quantityPulled = currentRecord?.pulled ?? 0;
        const quantityPreordered = Math.max(0, currentRecord?.quantityPulledFromPreorder ?? 0);
        const currentReceivedFromOrder = currentRecord?.quantityReceivedFromOrder ?? 0;
        const remaining = getRemainingQty({
          needed: quantityNeeded,
          fab: quantityFab,
          shop: quantityPulled,
          preorder: quantityPreordered,
          vendor: currentReceivedFromOrder,
        });
        quantityReceivedFromOrder = currentReceivedFromOrder + remaining;
      }

      // Get quantityOrdered to determine if fully received
      const quantityOrdered = currentRecord?.quantityOrdered ?? null;
      
      // Only mark as fully received if quantityReceivedFromOrder >= quantityOrdered
      // If quantityOrdered is null, we can't determine, so mark as received
      const isFullyReceived = quantityOrdered === null 
        ? true 
        : quantityReceivedFromOrder >= quantityOrdered;

      return prisma.job.update({
        where: {
          jobNumber_listNumber_partNumber: {
            jobNumber: currentRecord.jobNumber,
            listNumber: currentRecord.listNumber,
            partNumber: currentRecord.partNumber,
          },
        },
        data: {
          receivedFromOrder: isFullyReceived,
          quantityReceivedFromOrder: quantityReceivedFromOrder,
          pickupFromSupplier: isFullyReceived ? false : currentRecord.pickupFromSupplier,
          supplierDeliveryToJobsite: isFullyReceived ? false : currentRecord.supplierDeliveryToJobsite,
          updatedAt: new Date(),
        },
      });
    });

    const results = await Promise.all(updatePromises);
    totalUpdated += results.length;

    // Get unique job numbers for cache invalidation
    const uniqueJobNumbers = [...new Set(jobItems.map(i => i.jobNumber.trim()))];

    // Invalidate caches for affected jobs
    uniqueJobNumbers.forEach((jobNumber) => {
      cache.delete(cacheKeys.jobDetails(jobNumber));
    });
    cache.delete(cacheKeys.jobsList());
    cache.delete(cacheKeys.calendar());

    return NextResponse.json({
      success: true,
      updatedCount: totalUpdated,
      itemCount: items.length,
    });
  } catch (error) {
    console.error('Error in /api/admin/orders/mark-received:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
