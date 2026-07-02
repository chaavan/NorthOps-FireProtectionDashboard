import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { cache, cacheKeys } from '@/lib/cache';
import { requirePermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

interface ItemToMarkDelivery {
  jobNumber: string;
  listNumber: string;
  partNumber: string;
}

/**
 * POST /api/admin/orders/mark-delivery-to-jobsite
 * Marks selected ordered lines as delivery-to-jobsite-by-supplier.
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

    const auth = await requirePermission(session, 'orders.mark_jobsite_delivery');
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const { items } = body as { items: ItemToMarkDelivery[] };

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

    // For delivery-to-jobsite, count parts as fully covered by vendor for progress:
    // - Keep quantityOrdered as-is
    // - Set quantityReceivedFromOrder to at least quantityOrdered (or quantityNeeded when ordered=0)
    // - Do NOT set receivedFromOrder here so UI can still distinguish Delivery vs Received
    let totalUpdated = 0;

    await Promise.all(
      normalizedItems.map(async (item) => {
        const current = await prisma.job.findUnique({
          where: {
            jobNumber_listNumber_partNumber: {
              jobNumber: item.jobNumber,
              listNumber: item.listNumber,
              partNumber: item.partNumber,
            },
          },
        });

        if (!current) {
          return;
        }

        const quantityOrdered = current.quantityOrdered ?? 0;
        const currentReceived = current.quantityReceivedFromOrder ?? 0;
        const baseTarget =
          quantityOrdered > 0 ? quantityOrdered : current.quantityNeeded ?? 0;
        const newReceived = Math.max(currentReceived, baseTarget);

        const result = await prisma.job.updateMany({
          where: {
            jobNumber: item.jobNumber,
            listNumber: item.listNumber,
            partNumber: item.partNumber,
          },
          data: {
            supplierDeliveryToJobsite: true,
            pickupFromSupplier: false,
            quantityReceivedFromOrder: newReceived,
            updatedAt: new Date(),
          },
        });

        totalUpdated += result.count;
      })
    );

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
    console.error('Error in /api/admin/orders/mark-delivery-to-jobsite:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
