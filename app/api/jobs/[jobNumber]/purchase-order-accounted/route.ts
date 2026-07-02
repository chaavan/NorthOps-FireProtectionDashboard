import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isAdmin } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import {
  canAccessJob,
  jobHasAccessRecords,
} from '@/lib/jobAccess';
import {
  normalizeListContextForLookup,
  normalizeListNumber,
} from '@/lib/jobListContext';
import { getJobLinesFromDatabase } from '@/lib/jobsDatabase';
import { cache, cacheKeys } from '@/lib/cache';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/jobs/[jobNumber]/purchase-order-accounted
 * Body: { listNumber: string, purchaseOrderAccountedFor: boolean }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ jobNumber: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 },
      );
    }

    const role = (session.user as { role?: string }).role;
    const userEmail = (session.user as { email?: string }).email;
    if (!userEmail) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { jobNumber: rawJobNumber } = await params;
    const jobNumber = rawJobNumber?.trim();
    if (!jobNumber) {
      return NextResponse.json({ error: 'jobNumber is required' }, { status: 400 });
    }

    const body = await request.json();
    const listNumberContext =
      typeof body?.listNumberContext === 'string' ? body.listNumberContext : null;
    const normalizedFromContext =
      listNumberContext !== null
        ? normalizeListContextForLookup(listNumberContext)
        : null;
    const listNumber = normalizeListNumber(
      normalizedFromContext ??
        (typeof body?.listNumber === 'string' && body.listNumber.trim()
          ? body.listNumber.trim()
          : '1'),
    );

    if (typeof body?.purchaseOrderAccountedFor !== 'boolean') {
      return NextResponse.json(
        { error: 'purchaseOrderAccountedFor boolean is required' },
        { status: 400 },
      );
    }

    const canViewPurchaseOrder = await hasPermission(session, 'job.purchase_order.view', {
      jobNumber,
      listNumber: listNumberContext ?? listNumber,
    });

    if (!canViewPurchaseOrder) {
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to access this purchase order' },
        { status: 403 },
      );
    }

    // Check job access (gatekeeping only).
    if (!isAdmin(role)) {
      // Scoped to the list being acted on - a job can have access records
      // on one list but not another.
      const hasRecords = await jobHasAccessRecords(jobNumber, listNumberContext ?? listNumber);
      if (hasRecords) {
        const hasAccess = await canAccessJob(userEmail, jobNumber, listNumberContext ?? listNumber);
        if (!hasAccess) {
          return NextResponse.json(
            { error: 'Forbidden - You do not have access to this job' },
            { status: 403 },
          );
        }
      }
    }

    const result = await prisma.job.updateMany({
      where: {
        jobNumber,
        listNumber,
      },
      data: {
        purchaseOrderAccountedFor: body.purchaseOrderAccountedFor,
        updatedAt: new Date(),
      },
    });

    if (result.count === 0) {
      return NextResponse.json(
        { error: 'No job lines found for this job and list number' },
        { status: 404 },
      );
    }

    cache.delete(cacheKeys.jobsList());

    const fresh = await getJobLinesFromDatabase(jobNumber, listNumber);
    const res = NextResponse.json({
      success: true,
      purchaseOrderAccountedFor:
        fresh.jobMeta?.purchaseOrderAccountedFor ?? body.purchaseOrderAccountedFor,
      jobMeta: fresh.jobMeta,
    });
    res.headers.set('Cache-Control', 'no-store, max-age=0');
    return res;
  } catch (error) {
    console.error('Error in PATCH purchase-order-accounted:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
