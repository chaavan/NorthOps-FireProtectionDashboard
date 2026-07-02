import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { cache, cacheKeys } from '@/lib/cache';
import { requirePermission, hasPermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

type CancelItemInput = {
  jobNumber: string;
  listNumber?: string | null;
  partNumber: string;
};

type CancelResultStatus = 'CANCELLED' | 'BLOCKED_IN_PO' | 'NOT_FOUND';

type CancelResult = {
  jobNumber: string;
  listNumber: string | null;
  partNumber: string;
  status: CancelResultStatus;
  reason?: string;
};

type CurrentRow = {
  jobNumber: string;
  listNumber: string;
  partNumber: string;
  quantityReceivedFromOrder: number;
  receivedFromOrder: boolean | null;
};

function normalizeText(value: string | null | undefined): string {
  return String(value || '').trim();
}

function makeCompositeKey(jobNumber: string, listNumber: string | null | undefined, partNumber: string): string {
  return `${normalizeText(jobNumber)}::${normalizeText(listNumber)}::${normalizeText(partNumber)}`;
}

function makeLegacyKey(jobNumber: string, partNumber: string): string {
  return `${normalizeText(jobNumber)}::${normalizeText(partNumber)}`;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    const canCancel =
      (await hasPermission(session, 'orders.cancel')) ||
      (await hasPermission(session, 'orders.to_order.edit'));
    if (!canCancel) {
      return NextResponse.json(
        { error: 'Forbidden - Permission required', permission: 'orders.cancel' },
        { status: 403 },
      );
    }

    const body = await request.json();
    const { items } = body as { items?: CancelItemInput[]; mode?: 'strict' };
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'No items provided' }, { status: 400 });
    }

    const normalizedItems = items
      .map((item) => ({
        jobNumber: normalizeText(item.jobNumber),
        listNumber: normalizeText(item.listNumber) || null,
        partNumber: normalizeText(item.partNumber),
      }))
      .filter((item) => item.jobNumber && item.partNumber);

    if (normalizedItems.length === 0) {
      return NextResponse.json({ error: 'No valid items provided' }, { status: 400 });
    }

    const dedupedByKey = new Map<string, (typeof normalizedItems)[number]>();
    normalizedItems.forEach((item) => {
      const key = makeCompositeKey(item.jobNumber, item.listNumber, item.partNumber);
      if (!dedupedByKey.has(key)) {
        dedupedByKey.set(key, item);
      }
    });
    const dedupedItems = Array.from(dedupedByKey.values());

    const purchaseOrders = await prisma.purchaseOrder.findMany({
      select: {
        items: true,
      },
    });

    const exactPoKeys = new Set<string>();
    const legacyPoKeys = new Set<string>();
    const exactByLegacy = new Map<string, Set<string>>();

    purchaseOrders.forEach((po) => {
      const poItems = po.items as Array<{ jobNumber?: string; listNumber?: string | null; partNumber?: string; cancelled?: boolean }>;
      if (!Array.isArray(poItems)) return;
      poItems.forEach((poItem) => {
        if (poItem.cancelled === true) return;
        const jobNumber = normalizeText(poItem.jobNumber);
        const partNumber = normalizeText(poItem.partNumber);
        if (!jobNumber || !partNumber) return;

        const listNumber = normalizeText(poItem.listNumber);
        const legacyKey = makeLegacyKey(jobNumber, partNumber);

        if (!exactByLegacy.has(legacyKey)) {
          exactByLegacy.set(legacyKey, new Set());
        }

        if (listNumber) {
          const exactKey = makeCompositeKey(jobNumber, listNumber, partNumber);
          exactPoKeys.add(exactKey);
          exactByLegacy.get(legacyKey)!.add(exactKey);
        } else {
          legacyPoKeys.add(legacyKey);
        }
      });
    });

    const results: CancelResult[] = [];
    const affectedJobNumbers = new Set<string>();

    for (const item of dedupedItems) {
      const compositeKey = makeCompositeKey(item.jobNumber, item.listNumber, item.partNumber);
      const legacyKey = makeLegacyKey(item.jobNumber, item.partNumber);
      const hasExactLock = exactPoKeys.has(compositeKey);
      const hasLegacyLock = legacyPoKeys.has(legacyKey);
      const hasAnyExactForLegacy = (exactByLegacy.get(legacyKey)?.size || 0) > 0;
      const isLocked =
        hasExactLock ||
        hasLegacyLock ||
        (!item.listNumber && hasAnyExactForLegacy);

      if (isLocked) {
        results.push({
          jobNumber: item.jobNumber,
          listNumber: item.listNumber,
          partNumber: item.partNumber,
          status: 'BLOCKED_IN_PO',
          reason: 'Already sent in Purchase Order',
        });
        continue;
      }

      let currentRow: CurrentRow | null = null;

      if (item.listNumber) {
        currentRow = await prisma.job.findUnique({
          where: {
            jobNumber_listNumber_partNumber: {
              jobNumber: item.jobNumber,
              listNumber: item.listNumber,
              partNumber: item.partNumber,
            },
          },
          select: {
            jobNumber: true,
            listNumber: true,
            partNumber: true,
            quantityReceivedFromOrder: true,
            receivedFromOrder: true,
          },
        });
      }

      if (!currentRow) {
        currentRow = await prisma.job.findFirst({
          where: {
            jobNumber: item.jobNumber,
            partNumber: item.partNumber,
          },
          select: {
            jobNumber: true,
            listNumber: true,
            partNumber: true,
            quantityReceivedFromOrder: true,
            receivedFromOrder: true,
          },
        });
      }

      if (!currentRow) {
        results.push({
          jobNumber: item.jobNumber,
          listNumber: item.listNumber,
          partNumber: item.partNumber,
          status: 'NOT_FOUND',
          reason: 'Job line not found',
        });
        continue;
      }

      const shouldKeepReceivedFlag = (currentRow.quantityReceivedFromOrder ?? 0) > 0;
      await prisma.job.update({
        where: {
          jobNumber_listNumber_partNumber: {
            jobNumber: currentRow.jobNumber,
            listNumber: currentRow.listNumber,
            partNumber: currentRow.partNumber,
          },
        },
        data: {
          ordered: false,
          quantityOrdered: null,
          receivedFromOrder: shouldKeepReceivedFlag ? currentRow.receivedFromOrder : false,
          pickupFromSupplier: false,
          supplierDeliveryToJobsite: false,
          updatedAt: new Date(),
        },
      });

      affectedJobNumbers.add(currentRow.jobNumber);
      results.push({
        jobNumber: currentRow.jobNumber,
        listNumber: currentRow.listNumber,
        partNumber: currentRow.partNumber,
        status: 'CANCELLED',
      });
    }

    affectedJobNumbers.forEach((jobNumber) => {
      cache.delete(cacheKeys.jobDetails(jobNumber));
    });
    cache.delete(cacheKeys.jobsList());
    cache.delete(cacheKeys.calendar());

    const cancelledCount = results.filter((r) => r.status === 'CANCELLED').length;
    const blockedCount = results.filter((r) => r.status === 'BLOCKED_IN_PO').length;
    const notFoundCount = results.filter((r) => r.status === 'NOT_FOUND').length;

    return NextResponse.json({
      success: blockedCount === 0 && notFoundCount === 0,
      cancelledCount,
      blockedCount,
      notFoundCount,
      results,
    });
  } catch (error) {
    console.error('Error in /api/admin/orders/cancel:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
