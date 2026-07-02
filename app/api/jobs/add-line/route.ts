import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isAdmin } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { addJobLineToDatabase, getJobLinesFromDatabase } from '@/lib/jobsDatabase';
import { cache, cacheKeys } from '@/lib/cache';
import { canAccessJob, jobHasAccessRecords } from '@/lib/jobAccess';
import { normalizeListContextForLookup } from '@/lib/jobListContext';
import type { JobLineItem } from '@/lib/types';
import { parseDateInputInAppTimeZone } from '@/lib/timezone';

export const dynamic = 'force-dynamic';

/**
 * POST /api/jobs/add-line
 * Add a new line item to a job
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
    
    if (
      !(await hasPermission(session, 'job.puller.add_line', {
        jobNumber: typeof body?.jobNumber === 'string' ? body.jobNumber : undefined,
        listNumber: typeof body?.listNumberContext === 'string'
          ? body.listNumberContext
          : typeof body?.listNumber === 'string'
            ? body.listNumber
            : undefined,
      }))
    ) {
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to add line items' },
        { status: 403 }
      );
    }

    const listNumberContext =
      typeof body?.listNumberContext === 'string' ? body.listNumberContext : null;
    const normalizedFromContext =
      listNumberContext !== null
        ? normalizeListContextForLookup(listNumberContext)
        : null;
    const resolvedListNumber =
      normalizedFromContext ||
      (typeof body?.listNumber === 'string' && body.listNumber.trim()) ||
      '1';

    // Check job access if job already exists
    if (body.jobNumber) {
      if (!isUserAdmin) {
        // Scoped to the list being acted on - a job can have access
        // records on one list but not another.
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
      }
    }

    if (!body.jobNumber || !body.jobName) {
      return NextResponse.json(
        { error: 'jobNumber and jobName are required' },
        { status: 400 }
      );
    }

    // Try to get existing job details to preserve metadata, but don't fail if job doesn't exist yet
    let existingJob = null;
    try {
      const existingJobs = await getJobLinesFromDatabase(body.jobNumber);
      existingJob = existingJobs.lineItems[0];
    } catch (error) {
      // Job doesn't exist yet, that's okay - we'll create it with this line item
      console.log(`Job ${body.jobNumber} doesn't exist yet, creating with first line item`);
    }
    
    const result = await addJobLineToDatabase(
      body.jobNumber,
      body.jobName,
      {
        partNumber: body.partNumber || '',
        description: body.description || '',
        uom: body.uom || '',
        quantityNeeded: body.quantityNeeded || 0,
        quantityFab: body.quantityFab ?? 0,
        type: body.type || '',
        contractNumber: existingJob?.contractNumber || body.contractNumber || null,
        // Always use the resolved list number (from context/body), not an arbitrary existing job row
        listNumber: resolvedListNumber,
        area: existingJob?.area || body.area || null,
        locationShipTo: existingJob?.location || body.location || null,
        stocklistDeliveryShipDate: existingJob?.stocklistDate 
          ? parseDateInputInAppTimeZone(existingJob.stocklistDate) 
          : (body.stocklistDate ? parseDateInputInAppTimeZone(body.stocklistDate) : null),
      }
    );

    // Invalidate cache for this job and related data
    cache.delete(cacheKeys.jobDetails(body.jobNumber, resolvedListNumber));
    cache.delete(cacheKeys.jobsList());
    cache.delete(cacheKeys.calendar());

    return NextResponse.json({
      success: true,
      lineItems: result.lineItems,
    });
  } catch (error) {
    console.error('Error in /api/jobs/add-line:', error);
    const message = (error as Error).message ?? '';
    const isDuplicateLine =
      message.includes('already exists for job') && message.includes('list');
    if (isDuplicateLine) {
      return NextResponse.json(
        {
          error:
            'A job line with this job number, list number, and part number already exists.',
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
