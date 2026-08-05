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
import { recordLeadTimeSample } from '@/lib/vendorLeadTime';

export const dynamic = 'force-dynamic';

interface ItemToMark {
  jobNumber: string;
  listNumber?: string | null;
  partNumber: string;
  quantityReceived?: number | null;
  orderId?: string | null;
}

/**
 * A vendor lead-time observation queued during a receive. Written after the
 * transaction commits — bookkeeping must never be able to abort a receive.
 */
type LeadTimeSampleDraft = {
  vendorKey: string | null;
  purchaseOrderId: string;
  orderNumber: string | null;
  partNumber: string;
  partId: string | null;
  orderKind: string | null;
  sentAt: Date;
};

async function flushLeadTimeSamples(samples: LeadTimeSampleDraft[]): Promise<void> {
  for (const sample of samples) {
    await recordLeadTimeSample(sample);
  }
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
  leadTimeSamples: LeadTimeSampleDraft[],
): Promise<number> {
  if (items.length === 0) return 0;

  let updatedCount = 0;
  await prisma.$transaction(async (tx) => {
    const purchaseOrders = await tx.purchaseOrder.findMany({
      select: {
        id: true,
        orderNumber: true,
        items: true,
        orderKind: true,
        sentAt: true,
        supplier: true,
      },
      // Oldest first: a part can sit on several open inventory POs, and stock that
      // arrives should settle the earliest order first (FIFO).
      orderBy: { sentAt: 'asc' },
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

      // The On Order tab shows ONE row per inventory part, aggregating every open PO
      // line for it — so the quantity the user typed is the row total, not one PO's
      // share. Collect all of that part's open lines and spread the total across them
      // FIFO. (Previously this was scoped to item.orderId, i.e. only the NEWEST PO, so
      // receiving a part that sat on two POs updated one and left the other outstanding
      // forever: stock went up, yet the row stayed "On Order" with 0 received.)
      type LineRef = {
        po: (typeof inventoryPurchaseOrders)[number];
        index: number;
        ordered: number;
        priorReceived: number;
      };
      const lines: LineRef[] = [];
      for (const po of inventoryPurchaseOrders) {
        const poItems = (po.items ?? []) as InventoryPoLineItem[];
        if (!Array.isArray(poItems)) continue;
        poItems.forEach((poItem, index) => {
          if (poItem.cancelled === true) return;
          if (String(poItem.partNumber ?? '').trim() !== partNumber) return;
          if (
            po.orderKind !== 'INVENTORY' &&
            !isInventoryReplenishmentJobNumber(poItem.jobNumber)
          ) {
            return;
          }
          lines.push({
            po,
            index,
            ordered: toNonNegativeInt(poItem.quantityOrdered),
            priorReceived: toNonNegativeInt(poItem.quantityReceived),
          });
        });
      }
      if (lines.length === 0) continue;

      const orderedTotal = lines.reduce((sum, l) => sum + l.ordered, 0);
      const priorTotal = lines.reduce((sum, l) => sum + l.priorReceived, 0);

      // Absolute row total (matching what the tab displays), not an increment.
      let targetTotal =
        item.quantityReceived !== undefined && item.quantityReceived !== null
          ? toNonNegativeInt(item.quantityReceived)
          : orderedTotal;
      if (targetTotal > orderedTotal) targetTotal = orderedTotal;

      // Allocate the total across the lines, oldest PO first.
      let remaining = targetTotal;
      const allocation = new Map<LineRef, number>();
      for (const line of lines) {
        const give = Math.min(line.ordered, Math.max(0, remaining));
        allocation.set(line, give);
        remaining -= give;
      }

      // Resolve the part once — every line here is the same part number.
      const partIdHint = lines
        .map((l) => ((l.po.items as InventoryPoLineItem[])[l.index]?.partId ?? null))
        .find((id): id is string => !!id);
      const totalDelta = targetTotal - priorTotal;
      let part: { id: string } | null = null;
      if (totalDelta > 0) {
        part = partIdHint
          ? await tx.part.findUnique({ where: { id: partIdHint } })
          : await findPartRowByLookupVariants(partNumberLookupVariants(partNumber), tx);
        if (!part) {
          throw new Error(`Part not found for inventory receive: ${partNumber}`);
        }
      }

      // Apply per PO, so the ledger entry and lead-time sample stay attributed to the
      // specific order the stock settled against.
      const touchedPoIds = new Set<string>();
      for (const po of inventoryPurchaseOrders) {
        const poLines = lines.filter((l) => l.po.id === po.id);
        if (poLines.length === 0) continue;

        const poDelta = poLines.reduce(
          (sum, l) => sum + ((allocation.get(l) ?? 0) - l.priorReceived),
          0,
        );

        const poItems = [...((po.items ?? []) as InventoryPoLineItem[])];
        for (const line of poLines) {
          const newReceived = allocation.get(line) ?? 0;
          const poItem = poItems[line.index];
          poItems[line.index] = {
            ...poItem,
            jobNumber: poItem.jobNumber ?? item.jobNumber,
            listNumber: poItem.listNumber ?? item.listNumber ?? INVENTORY_REORDER_LIST_NUMBER,
            quantityReceived: newReceived,
            fullyReceived: line.ordered > 0 && newReceived >= line.ordered,
          };

          // Lead-time clock stops on this line's FIRST arrival (later partial receipts
          // don't restart it). Queued and written after the tx commits so lead-time
          // bookkeeping can never abort a receive.
          if (line.priorReceived === 0 && newReceived > 0 && part) {
            leadTimeSamples.push({
              vendorKey: po.supplier ?? null,
              purchaseOrderId: po.id,
              orderNumber: po.orderNumber,
              partNumber,
              partId: part.id,
              orderKind: po.orderKind,
              sentAt: po.sentAt,
            });
          }
        }

        if (poDelta > 0 && part) {
          await recordOperationalDelta(tx, {
            partId: part.id,
            signedDelta: poDelta,
            movementType: MovementType.UNPULL,
            contextType: ORDER_CONTEXT_TYPE,
            contextId: po.id,
            actorUserId,
            note: `Inventory PO receive | PO ${po.orderNumber}`,
          });
        }

        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { items: poItems },
        });
        // Keep the in-memory copy in step, so a second item in this same request that
        // touches the same PO sees the updated quantities.
        po.items = poItems as unknown as typeof po.items;
        touchedPoIds.add(po.id);
      }
      updatedCount += touchedPoIds.size;
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
    const leadTimeSamples: LeadTimeSampleDraft[] = [];

    if (inventoryItems.length > 0) {
      const inventoryUpdated = await markInventoryItemsReceived(
        inventoryItems,
        actorUserId,
        leadTimeSamples,
      );
      if (inventoryUpdated === 0) {
        return NextResponse.json(
          { error: 'No inventory purchase order lines were updated. Refresh and try again.' },
          { status: 409 },
        );
      }
      totalUpdated += inventoryUpdated;
    }

    if (jobItems.length === 0) {
      await flushLeadTimeSamples(leadTimeSamples);
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

    // Purchase orders referenced by the incoming job lines, for the lead-time clock.
    const jobOrderIds = [...new Set(jobItems.map((i) => i.orderId).filter((id): id is string => !!id))];
    const jobPurchaseOrders = jobOrderIds.length > 0
      ? await prisma.purchaseOrder.findMany({
          where: { id: { in: jobOrderIds } },
          select: { id: true, orderNumber: true, sentAt: true, supplier: true, orderKind: true },
        })
      : [];
    const poById = new Map(jobPurchaseOrders.map((po) => [po.id, po]));

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

      // Stop the vendor lead-time clock on this line's FIRST receipt. Requires the
      // client to pass the PO it's receiving against; skipped when unknown.
      const po = item.orderId ? poById.get(item.orderId) : null;

      if (po && (currentRecord.quantityReceivedFromOrder ?? 0) === 0 && quantityReceivedFromOrder > 0) {
        leadTimeSamples.push({
          vendorKey: po.supplier ?? currentRecord.type ?? null,
          purchaseOrderId: po.id,
          orderNumber: po.orderNumber,
          partNumber: currentRecord.partNumber,
          partId: null,
          orderKind: po.orderKind,
          sentAt: po.sentAt,
        });
      }

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

    await flushLeadTimeSamples(leadTimeSamples);

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
