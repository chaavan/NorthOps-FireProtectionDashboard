import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createJobWithMerge } from '@/lib/jobsDatabase';
import { cache, cacheKeys } from '@/lib/cache';
import { grantCreatorJobAccess, requirePermission } from '@/lib/permissions';
import { sendJobCreatedNotification } from '@/lib/notifications';
import { prisma } from '@/lib/prisma';
import { updateDeliveryRecord } from '@/lib/deliveryDatabase';
import { APP_TIME_ZONE, parseDateInputInAppTimeZone } from '@/lib/timezone';
import { autoAddEligibleUsersToJob } from '@/lib/autoAddJobAccess';
import {
  applyResolvedInitialAccessGrants,
  isInitialJobAccessGrantsError,
  resolveInitialAccessGrantsFromBody,
} from '@/lib/initialJobAccessGrants';

// Force this route to be dynamic
export const dynamic = 'force-dynamic';

/**
 * POST /api/jobs/create-with-merge
 * Create a job with duplicate handling (add/replace/skip logic)
 * 
 * Request body:
 * {
 *   jobNumber: string,
 *   jobName: string,
 *   listNumber?: string,
 *   contractNumber?: string,
 *   area?: string,
 *   locationShipTo?: string,
 *   stocklistDeliveryShipDate?: string,
 *   listedBy?: string,
 *   deliveryDate: string,
 *   lineItems: Array<{
 *     partNumber: string,
 *     quantityNeeded: number,
 *     quantityFab?: number,
 *     description?: string,
 *     unitOfMeasurement?: string,
 *     type?: string
 *   }>,
 *   duplicateAction?: 'add' | 'replace' | 'skip',
 *   perPartDecisions?: Record<string, 'add' | 'replace' | 'skip' | 'custom'>
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

    const permission = await requirePermission(session, 'jobs.create');
    if (!permission.ok) {
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to create jobs' },
        { status: 403 },
      );
    }

    const role = (session.user as any).role as string | undefined;

    // Parse request body
    const body = await request.json();
    const {
      jobNumber,
      jobName,
      contractNumber,
      listNumber,
      area,
      locationShipTo,
      stocklistDeliveryShipDate,
      listedBy,
      pulledBy,
      deliveryDate,
      isServiceJob,
      lineItems,
      duplicateAction,
      perPartDecisions,
      perPartCustomQuantities,
    } = body;

    // Validate required fields
    if (!jobNumber || !jobNumber.trim()) {
      return NextResponse.json(
        { error: 'jobNumber is required' },
        { status: 400 }
      );
    }

    const normalizedJobNumber = jobNumber.trim();
    if (!normalizedJobNumber) {
      return NextResponse.json(
        { error: 'jobNumber is required and must not be empty' },
        { status: 400 }
      );
    }
    if (/\s/.test(normalizedJobNumber)) {
      return NextResponse.json(
        { error: 'jobNumber cannot contain spaces. Use the numeric job code only.' },
        { status: 400 }
      );
    }
    if (normalizedJobNumber.includes('%')) {
      return NextResponse.json(
        { error: 'jobNumber contains invalid characters (like %).' },
        { status: 400 }
      );
    }

    if (!jobName || !jobName.trim()) {
      return NextResponse.json(
        { error: 'jobName is required' },
        { status: 400 }
      );
    }

    if (!deliveryDate) {
      return NextResponse.json(
        { error: 'deliveryDate is required' },
        { status: 400 }
      );
    }

    const incomingLineItems = Array.isArray(lineItems) ? lineItems : [];

    // Validate provided line items (if any)
    for (let i = 0; i < incomingLineItems.length; i += 1) {
      const item = incomingLineItems[i];
      if (!item?.partNumber || !String(item.partNumber).trim()) {
        return NextResponse.json(
          { error: `Line item ${i + 1}: partNumber is required` },
          { status: 400 },
        );
      }
      if (
        typeof item.quantityNeeded !== 'number' ||
        Number.isNaN(item.quantityNeeded) ||
        item.quantityNeeded < 0
      ) {
        return NextResponse.json(
          { error: `Line item ${i + 1}: quantityNeeded must be a number >= 0` },
          { status: 400 },
        );
      }
      if (
        item.quantityFab !== undefined &&
        (typeof item.quantityFab !== 'number' ||
          Number.isNaN(item.quantityFab) ||
          item.quantityFab < 0)
      ) {
        return NextResponse.json(
          { error: `Line item ${i + 1}: quantityFab must be a number >= 0 when provided` },
          { status: 400 },
        );
      }
    }

    if (perPartDecisions && typeof perPartDecisions === 'object') {
      for (const [partNumber, decision] of Object.entries(perPartDecisions)) {
        if (decision !== 'custom') continue;
        const customQty = perPartCustomQuantities?.[partNumber];
        if (
          typeof customQty !== 'number' ||
          Number.isNaN(customQty) ||
          customQty < 0
        ) {
          return NextResponse.json(
            {
              error: `Custom quantity is required and must be >= 0 for part "${partNumber}" when decision is custom`,
            },
            { status: 400 },
          );
        }
      }
    }

    console.log(`📋 Creating job ${jobNumber} with merge logic...`);
    console.log(`   Duplicate action: ${duplicateAction || 'replace'}`);
    console.log(`   Line items: ${incomingLineItems.length}`);
    if (perPartDecisions) {
      console.log(`   Per-part decisions: ${Object.keys(perPartDecisions).length}`);
    }
    if (perPartCustomQuantities) {
      console.log(`   Per-part custom quantities: ${Object.keys(perPartCustomQuantities).length}`);
    }

    // Parse dates
    const parsedDeliveryDate = parseDateInputInAppTimeZone(deliveryDate);
    if (!parsedDeliveryDate) {
      return NextResponse.json(
        { error: 'Invalid deliveryDate format' },
        { status: 400 }
      );
    }
    const parsedStocklistDate = stocklistDeliveryShipDate
      ? parseDateInputInAppTimeZone(stocklistDeliveryShipDate)
      : null;
    const resolvedListNumber =
      typeof listNumber === 'string' && listNumber.trim().length > 0
        ? listNumber.trim()
        : '1';
    const creatorEmail = (session.user as any).email;
    const fallbackPulledBy =
      (typeof pulledBy === 'string' && pulledBy.trim()) ||
      (session.user as any).name?.trim() ||
      creatorEmail?.trim() ||
      null;

    let resolvedAccessGrants: Awaited<
      ReturnType<typeof resolveInitialAccessGrantsFromBody>
    > = [];
    try {
      resolvedAccessGrants = await resolveInitialAccessGrantsFromBody(
        body.accessGrants,
        creatorEmail ?? null,
      );
    } catch (e) {
      if (isInitialJobAccessGrantsError(e)) {
        return NextResponse.json({ error: e.message }, { status: e.statusCode });
      }
      throw e;
    }

    // Only notify when this is a brand-new job (not adding to existing)
    const existingJob = await prisma.job.findFirst({
      where: {
        jobNumber: normalizedJobNumber,
        listNumber: resolvedListNumber,
      },
    });

    // Create job with merge logic
    const result = await createJobWithMerge({
      jobNumber: normalizedJobNumber,
      jobName: jobName.trim(),
      contractNumber: contractNumber?.trim() || null,
      listNumber: listNumber?.trim() || null,
      area: area?.trim() || null,
      locationShipTo: locationShipTo?.trim() || null,
      stocklistDeliveryShipDate: parsedStocklistDate,
      listedBy: listedBy?.trim() || null,
      pulledBy: fallbackPulledBy,
      deliveryDate: parsedDeliveryDate,
      lineItems: incomingLineItems,
      duplicateAction,
      perPartDecisions,
      perPartCustomQuantities,
      creatorTimezone: APP_TIME_ZONE,
    });

    // Add creator to the access list (CREATOR tag). Capability follows their role.
    if (creatorEmail) {
      await grantCreatorJobAccess(
        normalizedJobNumber,
        creatorEmail,
        resolvedListNumber,
      );
      console.log(`✅ Created JobAccess for ${creatorEmail} on job ${jobNumber}`);
    }

    try {
      await applyResolvedInitialAccessGrants({
        jobNumber: normalizedJobNumber,
        listNumber: resolvedListNumber,
        creatorEmail: creatorEmail ?? null,
        grants: resolvedAccessGrants,
        grantedByEmail: creatorEmail ?? '',
        grantedByRole: role,
      });
    } catch (e) {
      if (isInitialJobAccessGrantsError(e)) {
        return NextResponse.json({ error: e.message }, { status: e.statusCode });
      }
      throw e;
    }

    await updateDeliveryRecord(
      normalizedJobNumber,
      {
        jobName: jobName.trim(),
        jobArea: area?.trim() || null,
        address: locationShipTo?.trim() || null,
        date: deliveryDate,
        isServiceJob: isServiceJob ?? false,
      },
      resolvedListNumber,
    );

    const initialNoteContent =
      typeof body.initialNote?.content === 'string'
        ? body.initialNote.content.trim()
        : '';
    const initialNoteHasAttachments = body.initialNote?.hasAttachments === true;
    const initialNoteCreatedBy =
      ((session.user as any).name || creatorEmail || null) as string | null;
    const initialNote =
      initialNoteContent.length > 0 || initialNoteHasAttachments
        ? await prisma.jobNote.create({
            data: {
              jobNumber: normalizedJobNumber,
              listNumber: resolvedListNumber,
              content: initialNoteContent,
              createdBy: initialNoteCreatedBy,
            },
          })
        : null;

    // Invalidate cache
    cache.delete(cacheKeys.jobsList());
    cache.delete(cacheKeys.calendar());
    cache.delete(cacheKeys.jobDetails(normalizedJobNumber, resolvedListNumber));
    cache.delete(cacheKeys.delivery(normalizedJobNumber, resolvedListNumber));

    // This route is used from the create workflow, including duplicate add/replace.
    // Send the combined materials + initial-note email here; do not emit a separate
    // "new note" email for the initial note.
    const creatorName = (session.user as any).name;
    await sendJobCreatedNotification(
      normalizedJobNumber,
      creatorEmail ?? '',
      creatorName,
      {
        jobName: result.jobName,
        listNumber: resolvedListNumber,
        deliveryDate: parsedDeliveryDate,
        area: area?.trim() || null,
        locationShipTo: locationShipTo?.trim() || null,
        listedBy: listedBy?.trim() || null,
        contractNumber: contractNumber?.trim() || null,
        stocklistDeliveryShipDate: parsedStocklistDate,
        initialNote: initialNote
          ? {
              noteId: initialNote.id,
              content: initialNoteContent,
              createdBy: initialNoteCreatedBy,
              createdByEmail: creatorEmail ?? null,
              createdAt: initialNote.createdAt,
              hasAttachments: initialNoteHasAttachments,
            }
          : null,
        lineItems: result.lineItems.map((item) => ({
          partNumber: item.partNumber ?? '',
          description: item.description ?? null,
          quantityNeeded: item.quantityNeeded ?? 0,
          uom: item.uom ?? null,
          type: item.type ?? null,
        })),
      }
    ).catch((err) => {
      console.error('Error sending create-with-merge notification:', err);
    });

    if (!existingJob) {
      await autoAddEligibleUsersToJob({
        jobNumber: normalizedJobNumber,
        listNumber: resolvedListNumber,
        isServiceJob: isServiceJob === true,
      });
    }

    console.log(`✅ Successfully created/merged job ${jobNumber}`);

    return NextResponse.json({
      success: true,
      jobNumber: result.jobNumber,
      jobName: result.jobName,
      lineItemCount: result.lineItems.length,
      initialNoteId: initialNote?.id ?? null,
      createdNewJob: !existingJob,
      message: `Successfully created/updated job ${jobNumber}`,
    });

  } catch (error) {
    console.error('❌ Error in /api/jobs/create-with-merge:', error);

    if (isInitialJobAccessGrantsError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    const errorMessage = error instanceof Error ? error.message : 'Failed to create job';
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    return NextResponse.json(
      { 
        error: errorMessage,
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 }
    );
  }
}
