import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isAdmin, resolveSessionUserIdForAudit } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { getJobLinesFromDatabase } from '@/lib/jobsDatabase';
import { canAccessJob, jobHasAccessRecords } from '@/lib/jobAccess';
import { cache, cacheKeys } from '@/lib/cache';
import { adjustPartQuantityForJob } from '@/lib/partsDatabase';

// Force this route to be dynamic
export const dynamic = 'force-dynamic';

/**
 * POST /api/jobs/delete-line
 * Deletes a single line item (part) from a job
 * 
 * Request body:
 * {
 *   jobNumber: string;
 *   listNumber: string;
 *   partNumber: string;
 * }
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

    const role = (session.user as any).role;
    const userEmail = (session.user as any).email;
    const isUserAdmin = isAdmin(role);

    const body = await request.json();
    const { jobNumber, listNumber, partNumber, listNumberContext } = body;

    if (!jobNumber || !partNumber) {
      return NextResponse.json(
        { error: 'jobNumber and partNumber are required' },
        { status: 400 }
      );
    }

    const finalListNumber = (listNumber && String(listNumber).trim()) || '1';
    const canDeleteLineItems = await hasPermission(session, 'job.puller.delete_line', {
      jobNumber,
      listNumber: typeof listNumberContext === 'string' ? listNumberContext : finalListNumber,
    });
    if (!canDeleteLineItems) {
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to delete line items' },
        { status: 403 },
      );
    }

    // Check job access (gatekeeping only - capability is governed by the
    // permission check above, which already incorporates any per-job override).
    if (!isUserAdmin) {
      const accessListScope =
        typeof listNumberContext === 'string' ? listNumberContext : finalListNumber;
      // Scoped to the list being edited - a job can have access records on
      // one list but not another, and an unscoped check would wrongly
      // treat every list on the job as restricted.
      const hasRecords = await jobHasAccessRecords(jobNumber, accessListScope);

      if (hasRecords) {
        const hasAccess = await canAccessJob(userEmail, jobNumber, accessListScope);
        if (!hasAccess) {
          return NextResponse.json(
            { error: 'Forbidden - You do not have access to this job' },
            { status: 403 }
          );
        }
      }
      // No access records means the job is open - fall through and allow.
    }

    const normalizedJobNumber = jobNumber.trim();
    const normalizedPartNumber = partNumber.trim();
    const actorUserId = await resolveSessionUserIdForAudit(session);

    // Reconcile pulled inventory before deleting the line.
    await prisma.$transaction(async (tx) => {
      const existingLine = await tx.job.findUnique({
        where: {
          jobNumber_listNumber_partNumber: {
            jobNumber: normalizedJobNumber,
            listNumber: finalListNumber,
            partNumber: normalizedPartNumber,
          },
        },
      });

      if (!existingLine) {
        throw new Error('LINE_NOT_FOUND');
      }

      const pulledFromShop = existingLine.pulled ?? 0;
      if (pulledFromShop > 0 && existingLine.partNumber) {
        await adjustPartQuantityForJob(
          existingLine.partNumber,
          pulledFromShop,
          normalizedJobNumber,
          actorUserId,
          tx,
        );
      }

      await tx.job.delete({
        where: {
          jobNumber_listNumber_partNumber: {
            jobNumber: normalizedJobNumber,
            listNumber: finalListNumber,
            partNumber: normalizedPartNumber,
          },
        },
      });
    });

    // Invalidate caches
    cache.delete(cacheKeys.jobDetails(jobNumber.trim(), finalListNumber));
    cache.delete(cacheKeys.jobsList());
    cache.delete(cacheKeys.calendar());

    // Get updated line items
    const updatedJob = await getJobLinesFromDatabase(normalizedJobNumber);

    return NextResponse.json({
      success: true,
      jobNumber: normalizedJobNumber,
      partNumber: normalizedPartNumber,
      lineItems: updatedJob.lineItems,
    });
  } catch (error) {
    console.error('Error in /api/jobs/delete-line:', error);
    if ((error as Error).message === 'LINE_NOT_FOUND') {
      return NextResponse.json(
        { error: 'Line item not found' },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
