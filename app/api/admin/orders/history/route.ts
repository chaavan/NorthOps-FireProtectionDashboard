import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requirePermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function makeJobListKey(jobNumber: string, listNumber: string | null | undefined): string {
  return `${String(jobNumber || '').trim()}::${String(listNumber || '').trim()}`;
}

/**
 * GET /api/admin/orders/history
 * Returns all past purchase orders, ordered by sentAt DESC
 */
export async function GET(request: NextRequest) {
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

    // Get optional limit from query params
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : 50;

    // Fetch purchase orders
    const orders = await prisma.purchaseOrder.findMany({
      orderBy: {
        sentAt: 'desc',
      },
      take: limit,
    });

    const parsedItemsByOrderId = new Map<string, Array<{
      jobNumber: string;
      listNumber?: string | null;
      jobName: string;
      area?: string | null;
      partNumber: string;
      description: string | null;
      quantityOrdered: number;
      vendor: string | null;
      cancelled?: boolean;
      unitCostSnapshot?: number | null;
    }>>();
    const uniqueJobListKeys = new Set<string>();

    orders.forEach((order) => {
      const items = (order.items as Array<{
        jobNumber: string;
        listNumber?: string | null;
        jobName: string;
        partNumber: string;
        description: string | null;
        quantityOrdered: number;
        vendor: string | null;
        cancelled?: boolean;
        unitCostSnapshot?: number | null;
      }>).map((item) => ({
        jobNumber: String(item.jobNumber || '').trim(),
        listNumber: item.listNumber ? String(item.listNumber).trim() : null,
        jobName: String(item.jobName || '').trim(),
        partNumber: String(item.partNumber || '').trim(),
        description: item.description ?? null,
        quantityOrdered: Number(item.quantityOrdered || 0),
        vendor: item.vendor ?? null,
        cancelled: item.cancelled === true ? true : undefined,
        unitCostSnapshot:
          item.unitCostSnapshot === null || item.unitCostSnapshot === undefined
            ? null
            : Number(item.unitCostSnapshot),
      }));
      parsedItemsByOrderId.set(order.id, items);
      items.forEach((item) => {
        if (!item.jobNumber) return;
        uniqueJobListKeys.add(makeJobListKey(item.jobNumber, item.listNumber));
      });
    });

    const keyPairs = Array.from(uniqueJobListKeys)
      .map((key) => {
        const [jobNumber, listNumber] = key.split('::');
        return { jobNumber, listNumber };
      })
      .filter((pair) => pair.jobNumber);

    const jobRows = keyPairs.length > 0
      ? await prisma.job.findMany({
          where: {
            OR: keyPairs.map((pair) =>
              pair.listNumber
                ? { jobNumber: pair.jobNumber, listNumber: pair.listNumber }
                : { jobNumber: pair.jobNumber },
            ),
          },
          select: {
            jobNumber: true,
            listNumber: true,
            area: true,
          },
        })
      : [];

    const areaByJobListKey = new Map<string, string | null>();
    jobRows.forEach((row) => {
      areaByJobListKey.set(
        makeJobListKey(row.jobNumber, row.listNumber),
        row.area ?? null,
      );
    });

    // Transform for response
    const formattedOrders = orders.map((order) => {
      const items = (parsedItemsByOrderId.get(order.id) || []).map((item) => ({
        ...item,
        area:
          areaByJobListKey.get(makeJobListKey(item.jobNumber, item.listNumber)) ??
          null,
      }));

      // Get unique job numbers
      const jobNumbers = [...new Set(items.map(i => i.jobNumber))];

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        vendorPoLabel: (order as any).vendorPoLabel ?? null,
        orderKind: (order as any).orderKind ?? 'JOB',
        sentBy: order.sentBy,
        sentAt: order.sentAt,
        supplier: order.supplier,
        recipientTo: order.recipientTo,
        recipientCc: order.recipientCc,
        sendStatus: order.sendStatus,
        sendError: order.sendError,
        batchId: order.batchId,
        itemCount: items.length,
        jobCount: jobNumbers.length,
        jobNumbers,
        items, // Include full items for expandable view
      };
    });

    return NextResponse.json({
      orders: formattedOrders,
      total: orders.length,
    });
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Error in /api/admin/orders/history:', error);
    }
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
