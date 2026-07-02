import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isAdmin } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { updateDeliveryRecord } from '@/lib/deliveryDatabase';
import { cache, cacheKeys } from '@/lib/cache';
import { canAccessJob, jobHasAccessRecords } from '@/lib/jobAccess';
import type { DeliveryRecord } from '@/lib/deliveryTypes';
import { normalizeListContextForLookup } from '@/lib/jobListContext';

// Force this route to be dynamic
export const dynamic = 'force-dynamic';

/**
 * POST /api/delivery/update
 * Updates delivery record for a job
 */
export async function POST(request: NextRequest) {
  try {
    // Check authentication and permissions
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const role = (session.user as any).role;
    const userEmail = (session.user as any).email;
    const isUserAdmin = isAdmin(role);

    const body = await request.json();

    if (!body.jobNumber || typeof body.jobNumber !== 'string') {
      return NextResponse.json(
        { error: 'jobNumber is required' },
        { status: 400 }
      );
    }

    if (!body.data || typeof body.data !== 'object') {
      return NextResponse.json(
        { error: 'data is required' },
        { status: 400 }
      );
    }

    const listNumberContext =
      typeof body?.listNumberContext === 'string' ? body.listNumberContext : null;
    const normalizedListNumber = normalizeListContextForLookup(listNumberContext);

    if (
      !(await hasPermission(session, 'job.delivery.edit', {
        jobNumber: body.jobNumber,
        listNumber: listNumberContext,
      }))
    ) {
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to update delivery data' },
        { status: 403 }
      );
    }

    // Check job access (gatekeeping only).
    if (!isUserAdmin) {
      // Scoped to the list being acted on - a job can have access records
      // on one list but not another.
      const hasRecords = await jobHasAccessRecords(body.jobNumber, listNumberContext);
      if (hasRecords) {
        const hasAccess = await canAccessJob(userEmail, body.jobNumber, listNumberContext);
        if (!hasAccess) {
          return NextResponse.json(
            { error: 'Forbidden - You do not have access to this job' },
            { status: 403 }
          );
        }
      }
      // No access records means the job is open - fall through and allow.
    }

    const result = await updateDeliveryRecord(
      body.jobNumber,
      body.data,
      listNumberContext,
    );

    // Invalidate cache for delivery and calendar
    cache.delete(cacheKeys.delivery(body.jobNumber, normalizedListNumber));
    cache.delete(cacheKeys.calendar());

    return NextResponse.json({
      success: true,
      delivery: result,
    });
  } catch (error) {
    console.error('Error in /api/delivery/update:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
