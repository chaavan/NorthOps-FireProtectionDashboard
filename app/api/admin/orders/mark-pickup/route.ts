import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { cache, cacheKeys } from '@/lib/cache';
import { requirePermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

interface ItemToMarkPickup {
  jobNumber: string;
  listNumber: string;
  partNumber: string;
}

/**
 * POST /api/admin/orders/mark-pickup
 * Marks selected ordered lines as pickup-from-supplier.
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

    const auth = await requirePermission(session, 'orders.mark_pickup');
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const { items } = body as { items: ItemToMarkPickup[] };

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'No items provided' },
        { status: 400 }
      );
    }

    for (const item of items) {
      if (!item.jobNumber || !item.listNumber || !item.partNumber) {
        return NextResponse.json(
          { error: 'Each item must have jobNumber, listNumber, and partNumber' },
          { status: 400 }
        );
      }
    }

    const normalizedItems = items.map((item) => ({
      jobNumber: item.jobNumber.trim(),
      listNumber: item.listNumber.trim(),
      partNumber: item.partNumber.trim(),
    }));

    const updates = await Promise.all(
      normalizedItems.map((item) =>
        prisma.job.updateMany({
          where: {
            jobNumber: item.jobNumber,
            listNumber: item.listNumber,
            partNumber: item.partNumber,
          },
          data: {
            pickupFromSupplier: true,
            supplierDeliveryToJobsite: false,
            updatedAt: new Date(),
          },
        })
      )
    );

    const totalUpdated = updates.reduce((sum, result) => sum + result.count, 0);
    const uniqueJobNumbers = [...new Set(normalizedItems.map((item) => item.jobNumber))];

    uniqueJobNumbers.forEach((jobNumber) => {
      cache.delete(cacheKeys.jobDetails(jobNumber));
    });
    cache.delete(cacheKeys.jobsList());
    cache.delete(cacheKeys.calendar());

    return NextResponse.json({
      success: true,
      updatedCount: totalUpdated,
      itemCount: normalizedItems.length,
    });
  } catch (error) {
    console.error('Error in /api/admin/orders/mark-pickup:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
