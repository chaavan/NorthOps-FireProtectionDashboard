import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isAdmin } from '@/lib/auth';
import { hasPermission, getEffectivePermissionsForSession } from '@/lib/permissions';
import { bypassesJobAccessList } from '@/lib/jobScopedAccess';
import { prisma } from '@/lib/prisma';
import { cache, cacheKeys } from '@/lib/cache';
import { canAccessJob, jobHasAccessRecords } from '@/lib/jobAccess';

// Force this route to be dynamic
export const dynamic = 'force-dynamic';

/**
 * POST /api/jobs/mark-delivered
 * Marks line items as delivered or not delivered. When listNumber is provided, only that list is updated.
 *
 * Request body:
 * {
 *   jobNumber: string,
 *   delivered: boolean,
 *   listNumber?: string  // When provided, update only this list's line items
 * }
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
    const permissionDetails = await getEffectivePermissionsForSession(session);
    const bypassJobAccess = bypassesJobAccessList(role, permissionDetails);

    const body = await request.json();
    const listNumberContext =
      typeof body?.listNumberContext === 'string'
        ? body.listNumberContext
        : body?.listNumber || null;

    if (
      !(await hasPermission(session, 'job.delivery.mark_delivered', {
        jobNumber: body?.jobNumber,
        listNumber: listNumberContext,
      }))
    ) {
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to mark items as delivered' },
        { status: 403 }
      );
    }

    // Check job access (gatekeeping only - capability is governed by the
    // permission check above, which already incorporates any per-job override).
    if (!bypassJobAccess) {
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

    if (!body.jobNumber) {
      return NextResponse.json(
        { error: 'jobNumber is required' },
        { status: 400 }
      );
    }

    if (typeof body.delivered !== 'boolean') {
      return NextResponse.json(
        { error: 'delivered must be a boolean' },
        { status: 400 }
      );
    }

    const where: { jobNumber: string; listNumber?: string } = {
      jobNumber: body.jobNumber.trim(),
    };
    const listNumber = body.listNumber?.trim();
    if (listNumber) {
      where.listNumber = listNumber;
    }

    const result = await prisma.job.updateMany({
      where,
      data: {
        delivered: body.delivered,
        updatedAt: new Date(),
      },
    });

    // Invalidate cache (when listNumber omitted, we updated all lists so invalidate at least default)
    const listNum = body.listNumber?.trim() || '1';
    cache.delete(cacheKeys.jobDetails(body.jobNumber, listNum));
    cache.delete(cacheKeys.jobsList());
    cache.delete(cacheKeys.calendar());

    return NextResponse.json({
      success: true,
      updatedCount: result.count,
      delivered: body.delivered,
    });
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Error in /api/jobs/mark-delivered:', error);
    }
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
