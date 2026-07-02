import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { MovementType } from '@prisma/client';
import { authOptions, resolveSessionUserIdForAudit } from '@/lib/auth';
import { requirePermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { cache, cacheKeys } from '@/lib/cache';
import { partNumberLookupVariants } from '@/lib/inventoryQuantity';
import { findPartRowByLookupVariants } from '@/lib/partsDatabase';
import { ORDER_CONTEXT_TYPE, recordOperationalDelta } from '@/lib/inventoryLedger';
import { isInventoryReplenishmentJobNumber, type InventoryPoLineItem } from '@/lib/inventoryReorder';

export const dynamic = 'force-dynamic';

type POItem = {
  jobNumber?: string;
  listNumber?: string | null;
  partNumber?: string;
  quantityOrdered?: number;
  quantityReceived?: number;
  partId?: string | null;
  cancelled?: boolean;
};

type ReceivedSummary = {
  hasReceivedParts: boolean;
  receivedPartLines: number;
  totalReceivedQuantity: number;
};

const getReceivedSummary = async (items: POItem[]): Promise<ReceivedSummary> => {
  let receivedPartLines = 0;
  let totalReceivedQuantity = 0;

  for (const item of items) {
    const jobNumber = item?.jobNumber?.trim();
    const listNumber = item?.listNumber?.trim() || null;
    const partNumber = item?.partNumber?.trim();
    const qtyOrdered = Math.max(0, Number(item?.quantityOrdered) || 0);

    if (!jobNumber || !partNumber || qtyOrdered <= 0) continue;
    if (item.cancelled === true) continue;

    if (isInventoryReplenishmentJobNumber(jobNumber)) {
      const receivedForThisLine = Math.max(0, Number(item.quantityReceived ?? 0));
      if (receivedForThisLine > 0) {
        receivedPartLines += 1;
        totalReceivedQuantity += Math.min(qtyOrdered, receivedForThisLine);
      }
      continue;
    }

    const jobRows = await prisma.job.findMany({
      where: listNumber
        ? { jobNumber, listNumber, partNumber }
        : { jobNumber, partNumber },
      select: {
        quantityReceivedFromOrder: true,
      },
    });

    if (jobRows.length === 0) continue;

    const totalReceivedForItem = jobRows.reduce(
      (sum, row) => sum + (row.quantityReceivedFromOrder ?? 0),
      0
    );
    const receivedForThisLine = Math.min(qtyOrdered, totalReceivedForItem);
    if (receivedForThisLine > 0) {
      receivedPartLines += 1;
      totalReceivedQuantity += receivedForThisLine;
    }
  }

  return {
    hasReceivedParts: totalReceivedQuantity > 0,
    receivedPartLines,
    totalReceivedQuantity,
  };
};

/**
 * GET /api/admin/orders/history/[orderId]
 * Returns received summary for a Purchase Order (used by delete warning modal).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const auth = await requirePermission(session, 'orders.history.view');
    if (!auth.ok) return auth.response;

    const { orderId } = await params;
    if (!orderId?.trim()) {
      return NextResponse.json(
        { error: 'orderId is required' },
        { status: 400 }
      );
    }

    const purchaseOrder = await prisma.purchaseOrder.findUnique({
      where: { id: orderId.trim() },
      select: { id: true, items: true },
    });

    if (!purchaseOrder) {
      return NextResponse.json(
        { error: 'Purchase order not found' },
        { status: 404 }
      );
    }

    const items = (purchaseOrder.items ?? []) as POItem[];
    if (!Array.isArray(items)) {
      return NextResponse.json(
        { error: 'Invalid purchase order items' },
        { status: 400 }
      );
    }

    const summary = await getReceivedSummary(items);

    return NextResponse.json({
      orderId: purchaseOrder.id,
      ...summary,
    });
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Error in GET /api/admin/orders/history/[orderId]:', error);
    }
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/orders/history/[orderId]
 * Deletes a Purchase Order and unpulls all vendor-received parts:
 * - Adds quantity back to Part.quantity
 * - Reduces quantityReceivedFromOrder and quantityOrdered on Job rows
 * - Clears ordered/receivedFromOrder when quantityOrdered becomes 0
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const auth = await requirePermission(session, 'orders.history.delete');
    if (!auth.ok) return auth.response;

    const { orderId } = await params;
    if (!orderId?.trim()) {
      return NextResponse.json(
        { error: 'orderId is required' },
        { status: 400 }
      );
    }

    let returnToInventory = true;
    const body = await request.json().catch(() => null);
    if (body && typeof body.returnToInventory === 'boolean') {
      returnToInventory = body.returnToInventory;
    }

    const actorUserId = await resolveSessionUserIdForAudit(session);

    const purchaseOrder = await prisma.purchaseOrder.findUnique({
      where: { id: orderId.trim() },
    });

    if (!purchaseOrder) {
      return NextResponse.json(
        { error: 'Purchase order not found' },
        { status: 404 }
      );
    }

    const items = (purchaseOrder.items ?? []) as POItem[];
    if (!Array.isArray(items)) {
      return NextResponse.json(
        { error: 'Invalid purchase order items' },
        { status: 400 }
      );
    }

    const orderNumber = purchaseOrder.orderNumber;
    const isInventoryOrder = purchaseOrder.orderKind === 'INVENTORY';
    const affectedJobNumbers = new Set<string>();
    let unpulledCount = 0;
    let clearedReceivedCount = 0;

    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        const jobNumber = item?.jobNumber?.trim();
        const listNumber = item?.listNumber?.trim() || null;
        const partNumber = item?.partNumber?.trim();
        const qtyOrdered = Math.max(0, Number(item?.quantityOrdered) || 0);

        if (!jobNumber || !partNumber || qtyOrdered <= 0) continue;
        if (item.cancelled === true) continue;

        if (isInventoryOrder || isInventoryReplenishmentJobNumber(jobNumber)) {
          const toUnpull = Math.min(qtyOrdered, Math.max(0, Number(item.quantityReceived ?? 0)));
          if (toUnpull <= 0) continue;

          const part = item.partId
            ? await tx.part.findUnique({ where: { id: item.partId } })
            : await findPartRowByLookupVariants(partNumberLookupVariants(partNumber), tx);
          if (!part) continue;

          clearedReceivedCount += toUnpull;
          if (returnToInventory) {
            await recordOperationalDelta(tx, {
              partId: part.id,
              signedDelta: -toUnpull,
              movementType: MovementType.PULL,
              contextType: ORDER_CONTEXT_TYPE,
              contextId: orderId.trim(),
              actorUserId,
              note: `Reverse inventory on order history delete | PO ${orderNumber} | PN ${partNumber}`,
            });
            unpulledCount += toUnpull;
          }
          continue;
        }

        affectedJobNumbers.add(jobNumber);

        const part = await findPartRowByLookupVariants(partNumberLookupVariants(partNumber), tx);

        if (!part) continue;

        const jobRows = await tx.job.findMany({
          where: listNumber
            ? { jobNumber, listNumber, partNumber }
            : { jobNumber, partNumber },
          select: {
            jobNumber: true,
            listNumber: true,
            partNumber: true,
            quantityReceivedFromOrder: true,
            quantityOrdered: true,
          },
        });

        if (jobRows.length === 0) continue;

        const totalReceived = jobRows.reduce((sum, r) => sum + (r.quantityReceivedFromOrder ?? 0), 0);
        const toUnpull = Math.min(qtyOrdered, totalReceived);

        let remainingToUnpull = toUnpull;
        let remainingToDeductOrdered = qtyOrdered;

        for (const row of jobRows) {
          const rowReceived = row.quantityReceivedFromOrder ?? 0;
          const deductReceived = Math.min(rowReceived, remainingToUnpull);
          const newReceived = Math.max(0, rowReceived - deductReceived);
          remainingToUnpull -= deductReceived;

          const currentQtyOrdered = row.quantityOrdered ?? 0;
          const deductOrdered = Math.min(currentQtyOrdered, remainingToDeductOrdered);
          const newQtyOrdered = Math.max(0, currentQtyOrdered - deductOrdered);
          remainingToDeductOrdered -= deductOrdered;

          await tx.job.update({
            where: {
              jobNumber_listNumber_partNumber: {
                jobNumber,
                listNumber: row.listNumber,
                partNumber,
              },
            },
            data: {
              quantityReceivedFromOrder: newReceived,
              quantityOrdered: newQtyOrdered,
              ordered: newQtyOrdered <= 0 ? false : true,
              receivedFromOrder: newQtyOrdered <= 0 ? false : newReceived > 0,
            },
          });
        }

        if (toUnpull <= 0) continue;

        clearedReceivedCount += toUnpull;

        if (returnToInventory) {
          await recordOperationalDelta(tx, {
            partId: part.id,
            signedDelta: toUnpull,
            movementType: MovementType.UNPULL,
            contextType: ORDER_CONTEXT_TYPE,
            contextId: orderId.trim(),
            actorUserId,
            note: `Unpull on order history delete | PO ${orderNumber} | job ${jobNumber} | PN ${partNumber}`,
          });

          unpulledCount += toUnpull;
        }
      }

      await tx.purchaseOrder.delete({
        where: { id: orderId.trim() },
      });
    });

    affectedJobNumbers.forEach((jobNumber) => {
      cache.delete(cacheKeys.jobDetails(jobNumber));
    });
    cache.delete(cacheKeys.jobsList());
    cache.delete(cacheKeys.calendar());

    return NextResponse.json({
      success: true,
      orderId: orderId.trim(),
      returnToInventory,
      unpulledCount,
      clearedReceivedCount,
    });
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Error in DELETE /api/admin/orders/history/[orderId]:', error);
    }
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
