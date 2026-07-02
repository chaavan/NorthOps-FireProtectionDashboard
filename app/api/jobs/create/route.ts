import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createJobInDatabase } from '@/lib/jobsDatabase';
import { prisma } from '@/lib/prisma';
import { cache, cacheKeys } from '@/lib/cache';
import { grantCreatorJobAccess, requirePermission } from '@/lib/permissions';
import { updateDeliveryRecord } from '@/lib/deliveryDatabase';
import { sendJobCreatedNotification } from '@/lib/notifications';
import { APP_TIME_ZONE, parseDateInputInAppTimeZone } from '@/lib/timezone';
import { normalizeVendorKey } from '@/lib/vendorUtils';
import { autoAddEligibleUsersToJob } from '@/lib/autoAddJobAccess';
import {
  applyResolvedInitialAccessGrants,
  isInitialJobAccessGrantsError,
  resolveInitialAccessGrantsFromBody,
} from '@/lib/initialJobAccessGrants';

export const dynamic = 'force-dynamic';

/**
 * POST /api/jobs/create
 * Create a new job with an initial line item
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

    const body = await request.json();

    // Validate required fields
    if (!body.jobNumber || typeof body.jobNumber !== 'string' || !body.jobName || typeof body.jobName !== 'string') {
      return NextResponse.json(
        { error: 'jobNumber and jobName are required and must be strings' },
        { status: 400 }
      );
    }

    const normalizedJobNumber = body.jobNumber.trim();
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

    if (!body.deliveryDate) {
      return NextResponse.json(
        { error: 'deliveryDate is required' },
        { status: 400 }
      );
    }

    const lineItems = Array.isArray(body.lineItems) ? body.lineItems : [];

    // Validate all provided line items
    for (let i = 0; i < lineItems.length; i++) {
      const item = lineItems[i];
      if (!item.partNumber || !item.partNumber.trim()) {
        return NextResponse.json(
          { error: `Line item ${i + 1}: partNumber is required` },
          { status: 400 }
        );
      }
      if (item.quantityNeeded === undefined || item.quantityNeeded === null) {
        return NextResponse.json(
          { error: `Line item ${i + 1}: quantityNeeded is required` },
          { status: 400 }
        );
      }
      if (
        typeof item.quantityNeeded !== 'number' ||
        Number.isNaN(item.quantityNeeded) ||
        item.quantityNeeded < 0
      ) {
        return NextResponse.json(
          { error: `Line item ${i + 1}: quantityNeeded must be a number >= 0` },
          { status: 400 }
        );
      }
      if (
        item.quantityFab !== undefined &&
        (
          typeof item.quantityFab !== 'number' ||
          Number.isNaN(item.quantityFab) ||
          item.quantityFab < 0
        )
      ) {
        return NextResponse.json(
          { error: `Line item ${i + 1}: quantityFab must be a number >= 0 when provided` },
          { status: 400 }
        );
      }
    }

    // Parse dates - deliveryDate is required
    const deliveryDate = parseDateInputInAppTimeZone(body.deliveryDate);
    if (!deliveryDate) {
      return NextResponse.json(
        { error: 'Invalid deliveryDate format' },
        { status: 400 }
      );
    }

    // Parse stocklistDeliveryShipDate if provided
    let stocklistDeliveryShipDate: Date | null = null;
    if (body.stocklistDeliveryShipDate) {
      const parsedStocklist = parseDateInputInAppTimeZone(body.stocklistDeliveryShipDate);
      if (parsedStocklist) {
        stocklistDeliveryShipDate = parsedStocklist;
      }
    }
    const resolvedListNumber =
      typeof body.listNumber === 'string' && body.listNumber.trim().length > 0
        ? body.listNumber.trim()
        : '1';
    const existingJobList = await prisma.job.findFirst({
      where: {
        jobNumber: normalizedJobNumber,
        listNumber: resolvedListNumber,
      },
      select: { jobNumber: true },
    });

    const creatorEmail = (session.user as any).email as string | undefined;
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

    // Explicit pre-check: avoid duplicate (jobNumber, listNumber, partNumber) for consistent 409 message
    const duplicateMessage =
      'A job line with this job number, list number, and part number already exists.';
    for (const item of lineItems) {
      const partNumber = item.partNumber?.trim();
      if (!partNumber) continue;
      const existing = await prisma.job.findUnique({
        where: {
          jobNumber_listNumber_partNumber: {
            jobNumber: normalizedJobNumber,
            listNumber: resolvedListNumber,
            partNumber,
          },
        },
      });
      if (existing) {
        return NextResponse.json({ error: duplicateMessage }, { status: 409 });
      }
    }

    // Create the job with all line items using a fixed application timezone.
    const result = await createJobInDatabase({
      jobNumber: normalizedJobNumber,
      jobName: body.jobName,
      listNumber: body.listNumber || null,
      area: body.area || null,
      locationShipTo: body.locationShipTo || null,
      stocklistDeliveryShipDate: stocklistDeliveryShipDate,
      listedBy: body.listedBy || null,
      deliveryDate: deliveryDate,
      creatorTimezone: APP_TIME_ZONE,
      lineItems: lineItems.map((item: any) => ({
        partNumber: item.partNumber,
        quantityNeeded: item.quantityNeeded,
        quantityFab: item.quantityFab ?? 0,
        unitOfMeasurement: item.unitOfMeasurement || null,
        description: item.description || null,
        type: item.type ? normalizeVendorKey(item.type) : null,
      })),
    });

    // Add creator to the access list (CREATOR tag). Capability follows their role.
    if (creatorEmail) {
      await grantCreatorJobAccess(normalizedJobNumber, creatorEmail, resolvedListNumber);
      console.log(`✅ Created JobAccess for ${creatorEmail} on job ${body.jobNumber}`);
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

    // Create or update Delivery row with isServiceJob so calendar and admin show service jobs correctly
    await updateDeliveryRecord(normalizedJobNumber, {
      jobName: body.jobName,
      isServiceJob: body.isServiceJob ?? false,
    }, resolvedListNumber);

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

    // Invalidate cache for jobs list, calendar, and delivery
    cache.delete(cacheKeys.jobsList());
    cache.delete(cacheKeys.calendar());
    cache.delete(cacheKeys.jobDetails(normalizedJobNumber, resolvedListNumber));
    cache.delete(cacheKeys.delivery(normalizedJobNumber, resolvedListNumber));

    // Notify users in this job's access list (await so webhook runs before Vercel freezes the function)
    const creatorName = (session.user as any).name;
    await sendJobCreatedNotification(
      normalizedJobNumber,
      creatorEmail ?? '',
      creatorName,
      {
        jobName: result.jobName,
        listNumber: resolvedListNumber,
        deliveryDate,
        area: body.area || null,
        locationShipTo: body.locationShipTo || null,
        listedBy: body.listedBy || null,
        contractNumber: body.contractNumber ?? null,
        stocklistDeliveryShipDate: stocklistDeliveryShipDate ?? null,
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
      console.error('Error sending job-created notification:', err);
    });

    if (!existingJobList) {
      await autoAddEligibleUsersToJob({
        jobNumber: normalizedJobNumber,
        listNumber: resolvedListNumber,
        isServiceJob: body.isServiceJob === true,
      });
    }

    return NextResponse.json({
      success: true,
      jobNumber: result.jobNumber,
      jobName: result.jobName,
      initialNoteId: initialNote?.id ?? null,
      lineItems: result.lineItems,
    });
  } catch (error) {
    console.error('Error in /api/jobs/create:', error);

    if (isInitialJobAccessGrantsError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    const prismaError = error as { code?: string; meta?: { modelName?: string; target?: string[] } };
    const isP2002 = prismaError?.code === 'P2002';
    const isJobAccessConflict =
      isP2002 &&
      prismaError?.meta?.modelName === 'JobAccess' &&
      Array.isArray(prismaError?.meta?.target) &&
      prismaError.meta.target.length === 2 &&
      prismaError.meta.target.includes('job_number') &&
      prismaError.meta.target.includes('user_email');

    if (isJobAccessConflict) {
      return NextResponse.json(
        {
          error:
            'The job was created but assigning your access failed. The database may still use the old unique constraint on job access. Run: npx prisma migrate deploy',
        },
        { status: 500 }
      );
    }

    const duplicateMessage =
      'A job line with this job number, list number, and part number already exists.';
    const isJobLineUniqueViolation =
      isP2002 ||
      (error instanceof Error && error.message.includes('Unique constraint'));
    if (isJobLineUniqueViolation) {
      return NextResponse.json({ error: duplicateMessage }, { status: 409 });
    }

    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
