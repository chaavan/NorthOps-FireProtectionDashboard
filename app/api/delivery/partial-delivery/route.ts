import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isAdmin } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { updateDeliveryRecord } from '@/lib/deliveryDatabase';
import { cache, cacheKeys } from '@/lib/cache';
import { canAccessJob, jobHasAccessRecords } from '@/lib/jobAccess';
import { normalizeListContextForLookup } from '@/lib/jobListContext';
import { parseDateInputInAppTimeZone } from '@/lib/timezone';

export const dynamic = 'force-dynamic';

/**
 * POST /api/delivery/partial-delivery
 * Records a partial delivery for a job (note + timestamp). Does not set line items to delivered.
 * Body: { jobNumber: string, note?: string, recordedDate?: string (YYYY-MM-DD), listNumberContext?: string, clear?: true }
 * When clear is true, removes the partial delivery note and timestamp only.
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
    const jobNumber = body?.jobNumber?.trim();
    const clearPartial = body?.clear === true;
    const note = body?.note != null ? String(body.note).trim() : '';
    const listNumberContext =
      typeof body?.listNumberContext === 'string' ? body.listNumberContext : null;
    const normalizedListNumber = normalizeListContextForLookup(listNumberContext);

    if (!jobNumber) {
      return NextResponse.json(
        { error: 'jobNumber is required' },
        { status: 400 }
      );
    }

    if (
      !(await hasPermission(session, 'job.delivery.partial_delivery', {
        jobNumber,
        listNumber: listNumberContext,
      }))
    ) {
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to record partial delivery' },
        { status: 403 }
      );
    }

    // Check job access (gatekeeping only).
    if (!isUserAdmin) {
      // Scoped to the list being acted on - a job can have access records
      // on one list but not another.
      const hasRecords = await jobHasAccessRecords(jobNumber, listNumberContext);
      if (hasRecords) {
        const hasAccess = await canAccessJob(userEmail, jobNumber, listNumberContext);
        if (!hasAccess) {
          return NextResponse.json(
            { error: 'Forbidden - You do not have access to this job' },
            { status: 403 }
          );
        }
      }
      // No access records means the job is open - fall through and allow.
    }

    if (clearPartial) {
      const delivery = await updateDeliveryRecord(
        jobNumber,
        {
          partialDeliveryNote: null,
          partialDeliveryRecordedAt: null,
        },
        listNumberContext,
      );

      cache.delete(cacheKeys.delivery(jobNumber, normalizedListNumber));

      return NextResponse.json({
        success: true,
        jobNumber,
        cleared: true,
        partialDeliveryNote: delivery.partialDeliveryNote,
        partialDeliveryRecordedAt: delivery.partialDeliveryRecordedAt,
      });
    }

    const recordedDateRaw =
      body?.recordedDate != null ? String(body.recordedDate).trim() : '';
    let recordedAt: Date;
    if (recordedDateRaw) {
      const parsed = parseDateInputInAppTimeZone(recordedDateRaw);
      if (!parsed) {
        return NextResponse.json(
          { error: 'Invalid recordedDate; use YYYY-MM-DD.' },
          { status: 400 },
        );
      }
      recordedAt = parsed;
    } else {
      recordedAt = new Date();
    }

    const delivery = await updateDeliveryRecord(jobNumber, {
      partialDeliveryNote: note || null,
      partialDeliveryRecordedAt: recordedAt.toISOString(),
    }, listNumberContext);

    cache.delete(cacheKeys.delivery(jobNumber, normalizedListNumber));

    return NextResponse.json({
      success: true,
      jobNumber,
      partialDeliveryNote: delivery.partialDeliveryNote,
      partialDeliveryRecordedAt: delivery.partialDeliveryRecordedAt,
    });
  } catch (error) {
    console.error('Error in /api/delivery/partial-delivery:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
