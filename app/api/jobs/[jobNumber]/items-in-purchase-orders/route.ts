import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isAdmin } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { canAccessJob, jobHasAccessRecords } from '@/lib/jobAccess';
import { buildPoLineKey } from '@/lib/poLineKey';

// Force this route to be dynamic
export const dynamic = 'force-dynamic';

/**
 * GET /api/jobs/[jobNumber]/items-in-purchase-orders
 * Returns keys (jobNumber::listNumber::partNumber) for line items in this job that appear in any Purchase Order.
 * Used to determine which items can be "canceled" (not yet sent to vendor) vs which are in POs (pending receive).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobNumber: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const { jobNumber } = await params;
    const listNumberContext = request.nextUrl.searchParams.get('listNumber');

    if (!jobNumber) {
      return NextResponse.json(
        { error: 'jobNumber is required' },
        { status: 400 }
      );
    }

    if (
      !(await hasPermission(session, 'job.puller.view', {
        jobNumber,
        listNumber: listNumberContext,
      }))
    ) {
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission' },
        { status: 403 }
      );
    }

    const trimmedJobNumber = jobNumber.trim();
    const role = (session.user as any).role;
    const isUserAdmin = isAdmin(role);
    if (!isUserAdmin) {
      const userEmail = (session.user as any)?.email;
      if (!userEmail) {
        return NextResponse.json(
          { error: 'Forbidden - Missing user email' },
          { status: 403 }
        );
      }
      const hasRecords = await jobHasAccessRecords(trimmedJobNumber, listNumberContext);
      if (hasRecords) {
        const hasAccess = await canAccessJob(userEmail, trimmedJobNumber, listNumberContext);
        if (!hasAccess) {
          return NextResponse.json(
            { error: 'Forbidden - You do not have access to this job' },
            { status: 403 }
          );
        }
      }
    }

    const purchaseOrders = await prisma.purchaseOrder.findMany({
      select: { items: true },
    });

    const keys = new Set<string>();
    purchaseOrders.forEach((po) => {
      const items = po.items as Array<{
        jobNumber?: string;
        listNumber?: string | null;
        partNumber?: string;
        cancelled?: boolean;
      }>;
      if (Array.isArray(items)) {
        items.forEach((item) => {
          if (item.cancelled === true) return;
          const jobNum = item?.jobNumber?.trim();
          const partNum = item?.partNumber?.trim();
          if (jobNum === trimmedJobNumber && jobNum && partNum) {
            keys.add(buildPoLineKey(jobNum, item.listNumber, partNum));
          }
        });
      }
    });

    return NextResponse.json({
      keys: Array.from(keys),
    });
  } catch (error) {
    console.error('Error in /api/jobs/[jobNumber]/items-in-purchase-orders:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
