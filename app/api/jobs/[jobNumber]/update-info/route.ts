import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import {
  authOptions,
  isAdmin,
  resolveSessionUserRole,
} from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { getJobLinesFromDatabase } from '@/lib/jobsDatabase';
import { canAccessJob, jobHasAccessRecords } from '@/lib/jobAccess';
import { cache, cacheKeys } from '@/lib/cache';
import { updateDeliveryRecord } from '@/lib/deliveryDatabase';
import { parseDateInputInAppTimeZone } from '@/lib/timezone';
import { normalizeListNumber, LIST_CONTEXT_ALL } from '@/lib/jobListContext';
import {
  JOB_UPDATED_NOTIFICATION_SOURCE_OVERVIEW_EDIT,
  sendJobUpdatedNotification,
  type JobUpdateChange,
} from '@/lib/notifications';
import { JOB_NOTE_KIND_DELIVERY_DATE_CHANGE } from '@/lib/jobNotes';
import {
  applyJobTypeAccessRebalance,
  computeJobTypeAccessImpact,
  type JobTypeAccessImpact,
} from '@/lib/autoAddJobAccess';

// Force this route to be dynamic
export const dynamic = 'force-dynamic';

type JobInfoRowSnapshot = {
  jobName: string | null;
  listNumber: string | null;
  area: string | null;
  locationShipTo: string | null;
  stocklistDeliveryShipDate: Date | null;
  listedBy: string | null;
  deliveryDate: Date | null;
};

function normField(v: string | null | undefined): string {
  return (v ?? '').trim();
}

function dispField(v: string | null | undefined): string {
  const t = normField(v);
  return t === '' ? '—' : t;
}

function dateKeyDb(d: Date | null | undefined): string {
  if (!d) return '';
  return new Date(d).toISOString().split('T')[0];
}

function buildJobInfoChangeRows(params: {
  beforeJobNumber: string;
  afterJobNumber: string;
  beforeRow: JobInfoRowSnapshot | null;
  afterRow: JobInfoRowSnapshot | null;
  beforeServiceJob: boolean;
  afterServiceJob: boolean;
}): JobUpdateChange[] {
  const {
    beforeJobNumber,
    afterJobNumber,
    beforeRow,
    afterRow,
    beforeServiceJob,
    afterServiceJob,
  } = params;
  const changes: JobUpdateChange[] = [];

  if (beforeJobNumber.trim() !== afterJobNumber.trim()) {
    changes.push({
      field: 'jobNumber',
      label: 'Job number',
      before: beforeJobNumber.trim(),
      after: afterJobNumber.trim(),
    });
  }

  if (!beforeRow || !afterRow) {
    return changes;
  }

  const beforeList = normalizeListNumber(beforeRow.listNumber ?? '1');
  const afterList = normalizeListNumber(afterRow.listNumber ?? '1');
  if (beforeList !== afterList) {
    changes.push({
      field: 'listNumber',
      label: 'List number',
      before: beforeList,
      after: afterList,
    });
  }

  if (normField(beforeRow.jobName) !== normField(afterRow.jobName)) {
    changes.push({
      field: 'jobName',
      label: 'Job name',
      before: dispField(beforeRow.jobName),
      after: dispField(afterRow.jobName),
    });
  }

  if (normField(beforeRow.area) !== normField(afterRow.area)) {
    changes.push({
      field: 'area',
      label: 'Area',
      before: dispField(beforeRow.area),
      after: dispField(afterRow.area),
    });
  }

  if (normField(beforeRow.locationShipTo) !== normField(afterRow.locationShipTo)) {
    changes.push({
      field: 'locationShipTo',
      label: 'Ship to / location',
      before: dispField(beforeRow.locationShipTo),
      after: dispField(afterRow.locationShipTo),
    });
  }

  if (dateKeyDb(beforeRow.stocklistDeliveryShipDate) !== dateKeyDb(afterRow.stocklistDeliveryShipDate)) {
    changes.push({
      field: 'stocklistDeliveryShipDate',
      label: 'Stocklist delivery ship date',
      before:
        beforeRow.stocklistDeliveryShipDate == null
          ? '—'
          : dateKeyDb(beforeRow.stocklistDeliveryShipDate),
      after:
        afterRow.stocklistDeliveryShipDate == null
          ? '—'
          : dateKeyDb(afterRow.stocklistDeliveryShipDate),
    });
  }

  if (normField(beforeRow.listedBy).toLowerCase() !== normField(afterRow.listedBy).toLowerCase()) {
    changes.push({
      field: 'listedBy',
      label: 'Listed by',
      before: dispField(beforeRow.listedBy),
      after: dispField(afterRow.listedBy),
    });
  }

  if (dateKeyDb(beforeRow.deliveryDate) !== dateKeyDb(afterRow.deliveryDate)) {
    changes.push({
      field: 'deliveryDate',
      label: 'Delivery date',
      before: beforeRow.deliveryDate == null ? '—' : dateKeyDb(beforeRow.deliveryDate),
      after: afterRow.deliveryDate == null ? '—' : dateKeyDb(afterRow.deliveryDate),
    });
  }

  if (beforeServiceJob !== afterServiceJob) {
    changes.push({
      field: 'isServiceJob',
      label: 'Service job',
      before: beforeServiceJob ? 'Yes' : 'No',
      after: afterServiceJob ? 'Yes' : 'No',
    });
  }

  return changes;
}

/**
 * PUT /api/jobs/[jobNumber]/update-info
 * Updates job-level information (jobName, listNumber, etc.) for all line items
 * 
 * Request body:
 * {
 *   jobNumber?: string; // New job number (if changing)
 *   jobName?: string;
 *   listNumber?: string | null;
 *   area?: string | null;
 *   locationShipTo?: string | null;
 *   stocklistDeliveryShipDate?: string | null; // ISO date string
 *   listedBy?: string | null; // User email
 *   deliveryDate?: string | null; // ISO date string
 *   notificationSource?: string; // JOB_UPDATED_NOTIFICATION_SOURCE_OVERVIEW_EDIT to send job-updated email
 * }
 */
export async function PUT(
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

    const role =
      (await resolveSessionUserRole(session)) ?? (session.user as any).role;
    const userEmail = (session.user as any).email;
    const isUserAdmin = isAdmin(role);
    
    const { jobNumber } = await params;
    const body = (await request.json()) as {
      jobNumber?: string;
      jobName?: string;
      listNumber?: string | null;
      currentListNumber?: string | null;
      area?: string | null;
      locationShipTo?: string | null;
      stocklistDeliveryShipDate?: string | null;
      listedBy?: string | null;
      deliveryDate?: string | null;
      isServiceJob?: boolean;
      accessTypeChangeConfirmed?: boolean;
      listNumberContext?: string | null;
      notificationSource?: string | null;
      deliveryDateChangeNote?: string | null;
    };

    console.log(
      `[update-info] PUT jobNumber=${String(jobNumber).trim()} user=${String(userEmail || '').trim() || '(none)'} notificationSource=${body.notificationSource ?? '(none)'}`,
    );

    const listNumberContextForAccess =
      typeof body.listNumberContext === 'string'
        ? body.listNumberContext
        : (typeof body.listNumber === 'string' ? body.listNumber : null);

    if (!jobNumber) {
      return NextResponse.json(
        { error: 'jobNumber is required' },
        { status: 400 }
      );
    }

    if (
      !(await hasPermission(session, 'jobs.edit_metadata', {
        jobNumber,
        listNumber: listNumberContextForAccess,
      }))
    ) {
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to edit job information' },
        { status: 403 },
      );
    }

    // Check job access: Admins can edit all jobs. For others, the per-job
    // access list only applies if the job actually has access records —
    // jobs without any are open to anyone with the jobs.edit_metadata
    // permission checked above (matches the pattern used by every other
    // job-mutating route, e.g. add-line/route.ts).
    if (!isUserAdmin) {
      // Scoped to the list being edited - a job can have access records on
      // one list (e.g. a restricted contract list) but not another, and an
      // unscoped check would wrongly treat every list as restricted.
      const hasRecords = await jobHasAccessRecords(jobNumber, listNumberContextForAccess);

      if (hasRecords) {
        const hasAccess = await canAccessJob(userEmail, jobNumber, listNumberContextForAccess);
        if (!hasAccess) {
          return NextResponse.json(
            { error: 'Forbidden - You do not have access to this job' },
            { status: 403 }
          );
        }
      }
    }

    // Get all line items for this job
    const currentJob = await getJobLinesFromDatabase(jobNumber);
    const normalizedJobNumber = jobNumber.trim();

    // Jobs can exist without real line items (placeholder-backed).
    // In that case, keep using job-level metadata for updates.

    // Current (old) list: from explicit currentListNumber, or listNumberContext if single list, or first line item
    const currentListFromContext =
      typeof body.currentListNumber === 'string' && body.currentListNumber.trim()
        ? body.currentListNumber.trim()
        : null;
    const contextSingleList =
      typeof body.listNumberContext === 'string' &&
      body.listNumberContext.trim() &&
      body.listNumberContext.trim() !== LIST_CONTEXT_ALL
        ? body.listNumberContext.trim()
        : null;
    const oldListNumber = normalizeListNumber(
      currentListFromContext ??
        contextSingleList ??
        currentJob.lineItems[0]?.listNumber ??
        currentJob.jobMeta?.listNumber ??
        '1',
    );

    const [beforeJobRow, beforeDeliveryRecord] = await Promise.all([
      prisma.job.findFirst({
        where: { jobNumber: normalizedJobNumber, listNumber: oldListNumber },
        select: {
          jobName: true,
          listNumber: true,
          area: true,
          locationShipTo: true,
          stocklistDeliveryShipDate: true,
          listedBy: true,
          deliveryDate: true,
        },
      }),
      prisma.delivery.findUnique({
        where: {
          jobNumber_listNumber: {
            jobNumber: normalizedJobNumber,
            listNumber: oldListNumber,
          },
        },
        select: { isServiceJob: true },
      }),
    ]);

    // Prepare update data
    const updateData: any = {};
    
    if (body.jobName !== undefined) {
      updateData.jobName = body.jobName.trim();
    }
    if (body.listNumber !== undefined) {
      updateData.listNumber = body.listNumber?.trim() || null;
    }
    if (body.area !== undefined) {
      updateData.area = body.area?.trim() || null;
    }
    if (body.locationShipTo !== undefined) {
      updateData.locationShipTo = body.locationShipTo?.trim() || null;
    }
    if (body.stocklistDeliveryShipDate !== undefined) {
      if (body.stocklistDeliveryShipDate) {
        const parsedStocklistDate = parseDateInputInAppTimeZone(body.stocklistDeliveryShipDate);
        if (!parsedStocklistDate) {
          return NextResponse.json(
            { error: 'Invalid stocklistDeliveryShipDate format' },
            { status: 400 }
          );
        }
        updateData.stocklistDeliveryShipDate = parsedStocklistDate;
      } else {
        updateData.stocklistDeliveryShipDate = null;
      }
    }
    if (body.listedBy !== undefined) {
      updateData.listedBy = body.listedBy?.trim() || null;
    }
    if (body.deliveryDate !== undefined) {
      if (body.deliveryDate) {
        const parsedDeliveryDate = parseDateInputInAppTimeZone(body.deliveryDate);
        if (!parsedDeliveryDate) {
          return NextResponse.json(
            { error: 'Invalid deliveryDate format' },
            { status: 400 }
          );
        }
        updateData.deliveryDate = parsedDeliveryDate;
      } else {
        updateData.deliveryDate = new Date(); // Required field, default to now if not provided
      }
    }

    updateData.updatedAt = new Date();

    let pendingTypeAccessImpact: JobTypeAccessImpact | null = null;
    const isJobTypeChanging =
      body.isServiceJob !== undefined &&
      (beforeDeliveryRecord?.isServiceJob === true) !== body.isServiceJob;

    if (isJobTypeChanging) {
      const impact = await computeJobTypeAccessImpact({
        jobNumber: normalizedJobNumber,
        listNumber: oldListNumber,
        isServiceJob: body.isServiceJob === true,
        editorEmail: typeof userEmail === 'string' ? userEmail : null,
      });

      const needsConfirmation =
        impact.autoRemoved.length > 0 ||
        impact.autoAdded.length > 0 ||
        impact.editorWouldLoseAccess;
      if (
        impact.manualMismatches.length > 0 ||
        (needsConfirmation && body.accessTypeChangeConfirmed !== true)
      ) {
        return NextResponse.json(
          {
            error:
              impact.manualMismatches.length > 0
                ? 'Review job access before changing this job type.'
                : impact.editorWouldLoseAccess
                  ? 'Changing this job type may remove your access. Confirm to continue.'
                  : 'Confirm automatic job access changes before changing this job type.',
            code: 'JOB_TYPE_ACCESS_REVIEW_REQUIRED',
            canConfirm: impact.manualMismatches.length === 0,
            accessReview: impact,
          },
          { status: 409 },
        );
      }

      pendingTypeAccessImpact = impact;
    }

    const newListNumberRaw = body.listNumber?.trim() || null;
    const newListNumber = newListNumberRaw
      ? normalizeListNumber(newListNumberRaw)
      : null;
    const isListNumberChanging =
      newListNumber != null &&
      oldListNumber != null &&
      oldListNumber !== newListNumber;

    let finalListNumber: string | undefined;

    // List number change: conflict check then migrate related tables
    if (isListNumberChanging) {
      // Conflict: target list already has Delivery for this job
      const existingDelivery = await prisma.delivery.findUnique({
        where: {
          jobNumber_listNumber: {
            jobNumber: normalizedJobNumber,
            listNumber: newListNumber,
          },
        },
      });
      if (existingDelivery) {
        return NextResponse.json(
          {
            error: `Job already has a delivery record for list "${newListNumber}". Use a different list or remove that record first.`,
          },
          { status: 400 },
        );
      }
      // Conflict: target list already has Job line items for this job
      const existingJobOnNewList = await prisma.job.findFirst({
        where: {
          jobNumber: normalizedJobNumber,
          listNumber: newListNumber,
        },
      });
      if (existingJobOnNewList) {
        return NextResponse.json(
          {
            error: `Job already has line items for list "${newListNumber}". Use a different list.`,
          },
          { status: 400 },
        );
      }

      await prisma.$transaction(async (tx) => {
        // Job: update listNumber (and other fields) for rows on old list
        await tx.job.updateMany({
          where: {
            jobNumber: normalizedJobNumber,
            listNumber: oldListNumber,
          },
          data: { ...updateData, listNumber: newListNumber },
        });
        // Delivery: move row to new list
        await tx.delivery.updateMany({
          where: {
            jobNumber: normalizedJobNumber,
            listNumber: oldListNumber,
          },
          data: { listNumber: newListNumber },
        });
        // JobAccess: update listNumber; may conflict if same user has access for new list - skip those or reject earlier
        const accessToUpdate = await tx.jobAccess.findMany({
          where: {
            jobNumber: normalizedJobNumber,
            listNumber: oldListNumber,
          },
        });
        for (const acc of accessToUpdate) {
          const conflict = await tx.jobAccess.findUnique({
            where: {
              jobNumber_listNumber_userEmail: {
                jobNumber: normalizedJobNumber,
                listNumber: newListNumber,
                userEmail: acc.userEmail,
              },
            },
          });
          if (!conflict) {
            await tx.jobAccess.update({
              where: { id: acc.id },
              data: { listNumber: newListNumber },
            });
          }
        }
        // JobNote
        await tx.jobNote.updateMany({
          where: {
            jobNumber: normalizedJobNumber,
            listNumber: oldListNumber,
          },
          data: { listNumber: newListNumber },
        });
        // JobNoteAttachment
        await tx.jobNoteAttachment.updateMany({
          where: {
            jobNumber: normalizedJobNumber,
            listNumber: oldListNumber,
          },
          data: { listNumber: newListNumber },
        });
        // JobLiveViewSession
        await tx.jobLiveViewSession.updateMany({
          where: {
            jobNumber: normalizedJobNumber,
            listNumber: oldListNumber,
          },
          data: { listNumber: newListNumber },
        });
      });

      finalListNumber = newListNumber;
    }

    // Check if jobNumber is being changed
    const newJobNumber = body.jobNumber?.trim();
    const isJobNumberChanging = newJobNumber && newJobNumber !== normalizedJobNumber;
    let finalJobNumber = normalizedJobNumber;

    if (isJobNumberChanging) {
      // Check if new job number already exists for any list we're moving (scope by list to allow same job number on another list)
      const listNumbersInJob = [
        ...new Set(
          (
            currentJob.lineItems.length > 0
              ? currentJob.lineItems.map((li) => (li.listNumber ?? '1').toString())
              : [currentJob.jobMeta?.listNumber ?? '1']
          )
        ),
      ];
      for (const listNum of listNumbersInJob) {
        const existingRow = await prisma.job.findFirst({
          where: {
            jobNumber: newJobNumber,
            listNumber: listNum,
          },
        });
        if (existingRow) {
          return NextResponse.json(
            {
              error: `Job number "${newJobNumber}" already exists for list ${listNum}. Use a different job number or list.`,
            },
            { status: 400 }
          );
        }
      }

      // If jobNumber is changing, we need to update all related records
      // Since jobNumber is part of the composite primary key, we need to delete and recreate
      // Get all current job records
      const allJobRecords = await prisma.job.findMany({
        where: { jobNumber: normalizedJobNumber },
      });

      // Create new records with new jobNumber
      const createOperations = allJobRecords.map((record) => {
        const newRecord = { ...record };
        delete (newRecord as any).createdAt; // Let Prisma set this
        delete (newRecord as any).updatedAt; // Let Prisma set this
        return prisma.job.create({
          data: {
            ...newRecord,
            jobNumber: newJobNumber,
            ...updateData,
          },
        });
      });

      // Delete old records
      const deleteOperation = prisma.job.deleteMany({
        where: { jobNumber: normalizedJobNumber },
      });

      // Execute delete and create in transaction
      await prisma.$transaction([deleteOperation, ...createOperations]);

      // Update JobAccess records
      await prisma.jobAccess.updateMany({
        where: { jobNumber: normalizedJobNumber },
        data: { jobNumber: newJobNumber },
      });

      // Update Delivery records
      await prisma.delivery.updateMany({
        where: { jobNumber: normalizedJobNumber },
        data: { jobNumber: newJobNumber },
      });

      // Update JobNote records
      await prisma.jobNote.updateMany({
        where: { jobNumber: normalizedJobNumber },
        data: { jobNumber: newJobNumber },
      });

      // Update JobNoteAttachment records
      await prisma.jobNoteAttachment.updateMany({
        where: { jobNumber: normalizedJobNumber },
        data: { jobNumber: newJobNumber },
      });

      // Update JobNotification records
      await prisma.jobNotification.updateMany({
        where: { jobNumber: normalizedJobNumber },
        data: { jobNumber: newJobNumber },
      });

      finalJobNumber = newJobNumber;
    } else if (!isListNumberChanging) {
      // Normal update - jobNumber and list number not changing; scope by list we're editing
      const scopeListNumber =
        body.listNumber?.trim() || body.currentListNumber?.trim() || null;
      if (scopeListNumber) {
        await prisma.job.updateMany({
          where: {
            jobNumber: normalizedJobNumber,
            listNumber: normalizeListNumber(scopeListNumber),
          },
          data: updateData,
        });
      } else {
        await prisma.$transaction(
          currentJob.lineItems.map((item) =>
            prisma.job.updateMany({
              where: {
                jobNumber: normalizedJobNumber,
                partNumber: item.partNumber || '',
              },
              data: updateData,
            }),
          ),
        );
      }
    }

    const explicitListContextValue =
      typeof body.listNumberContext === 'string'
        ? body.listNumberContext.trim()
        : '';
    const scopedListFromContext =
      explicitListContextValue && explicitListContextValue !== '__ALL__'
        ? explicitListContextValue
        : '';
    const fallbackListFromBody =
      typeof body.listNumber === 'string' && body.listNumber.trim().length > 0
        ? body.listNumber.trim()
        : '';
    const deliveryTargetLists = isListNumberChanging && finalListNumber
      ? [finalListNumber]
      : Array.from(
          new Set(
            (scopedListFromContext
              ? [scopedListFromContext]
              : fallbackListFromBody
                ? [fallbackListFromBody]
                : currentJob.lineItems.length > 0
                  ? currentJob.lineItems.map((item) =>
                      normalizeListNumber(item.listNumber),
                    )
                  : [normalizeListNumber(currentJob.jobMeta?.listNumber ?? '1')]
            ).map((list) => normalizeListNumber(list)),
          ),
        );

    // Keep delivery record job-level fields aligned with Edit Job modal updates.
    // Delivery tab renders jobName/jobArea/address primarily from delivery record.
    if (
      body.locationShipTo !== undefined ||
      body.jobName !== undefined ||
      body.area !== undefined
    ) {
      const newLocationShipTo =
        body.locationShipTo !== undefined
          ? body.locationShipTo?.trim() || null
          : undefined;
      const newJobName =
        body.jobName !== undefined ? body.jobName.trim() || null : undefined;
      const newJobArea =
        body.area !== undefined ? body.area?.trim() || null : undefined;

      try {
        await Promise.all(
          deliveryTargetLists.map((listNumber) =>
            updateDeliveryRecord(
              finalJobNumber,
              {
                ...(newLocationShipTo !== undefined
                  ? { address: newLocationShipTo }
                  : {}),
                ...(newJobName !== undefined ? { jobName: newJobName } : {}),
                ...(newJobArea !== undefined ? { jobArea: newJobArea } : {}),
              },
              listNumber,
            ),
          ),
        );
      } catch (deliveryError) {
        // Log error but don't fail the entire request if delivery update fails
        console.error('Error updating delivery record job fields:', deliveryError);
      }
    }

    // Update delivery record isServiceJob if provided
    if (body.isServiceJob !== undefined) {
      try {
        await Promise.all(
          deliveryTargetLists.map((listNumber) =>
            updateDeliveryRecord(
              finalJobNumber,
              {
                isServiceJob: body.isServiceJob,
              },
              listNumber,
            ),
          ),
        );
      } catch (deliveryError) {
        console.error('Error updating delivery record isServiceJob:', deliveryError);
      }

      if (pendingTypeAccessImpact) {
        await applyJobTypeAccessRebalance({
          jobNumber: finalJobNumber,
          listNumber: normalizeListNumber(finalListNumber ?? oldListNumber),
          impact: pendingTypeAccessImpact,
        });
      }
    }

    // Update delivery record date when deliveryDate changes so Delivery tab matches Edit modal
    if (body.deliveryDate !== undefined && body.deliveryDate !== null && body.deliveryDate !== '') {
      try {
        await Promise.all(
          deliveryTargetLists.map((listNumber) =>
            updateDeliveryRecord(
              finalJobNumber,
              { date: body.deliveryDate! },
              listNumber,
            ),
          ),
        );
      } catch (deliveryError) {
        console.error('Error updating delivery record date:', deliveryError);
      }
    }

    // Invalidate cache (use list number from body or first line item)
    const listNum =
      finalListNumber ??
      body.listNumber?.trim() ??
      currentJob.lineItems[0]?.listNumber ??
      currentJob.jobMeta?.listNumber ??
      '1';
    cache.delete(cacheKeys.jobDetails(normalizedJobNumber, listNum));
    cache.delete(cacheKeys.jobDetails(finalJobNumber, listNum));
    cache.delete(cacheKeys.jobsList());
    cache.delete(cacheKeys.calendar());
    if (
      body.locationShipTo !== undefined ||
      body.isServiceJob !== undefined ||
      body.deliveryDate !== undefined ||
      isListNumberChanging
    ) {
      deliveryTargetLists.forEach((listNumber) => {
        cache.delete(cacheKeys.delivery(finalJobNumber, listNumber));
      });
      cache.deletePattern(`^delivery:${finalJobNumber}:`);
      if (isJobNumberChanging) {
        deliveryTargetLists.forEach((listNumber) => {
          cache.delete(cacheKeys.delivery(normalizedJobNumber, listNumber));
        });
        cache.deletePattern(`^delivery:${normalizedJobNumber}:`);
      }
      if (isListNumberChanging && oldListNumber) {
        cache.delete(cacheKeys.delivery(finalJobNumber, oldListNumber));
      }
    }

    // Get updated job data
    const updatedJob = await getJobLinesFromDatabase(finalJobNumber);

    try {
      const notifyListNumber = normalizeListNumber(finalListNumber ?? oldListNumber);

      const [afterJobRow, afterDeliveryRecord] = await Promise.all([
        prisma.job.findFirst({
          where: { jobNumber: finalJobNumber, listNumber: notifyListNumber },
          select: {
            jobName: true,
            listNumber: true,
            area: true,
            locationShipTo: true,
            stocklistDeliveryShipDate: true,
            listedBy: true,
            deliveryDate: true,
          },
        }),
        prisma.delivery.findUnique({
          where: {
            jobNumber_listNumber: {
              jobNumber: finalJobNumber,
              listNumber: notifyListNumber,
            },
          },
          select: { isServiceJob: true },
        }),
      ]);

      const changes = buildJobInfoChangeRows({
        beforeJobNumber: normalizedJobNumber,
        afterJobNumber: finalJobNumber,
        beforeRow: beforeJobRow,
        afterRow: afterJobRow,
        beforeServiceJob: beforeDeliveryRecord?.isServiceJob === true,
        afterServiceJob: afterDeliveryRecord?.isServiceJob === true,
      });

      const updatedByName =
        typeof (session.user as { name?: string | null }).name === 'string'
          ? (session.user as { name?: string | null }).name?.trim() || null
          : null;
      const updatedByEmailStr =
        typeof userEmail === 'string' ? userEmail.trim() : null;

      const shouldSendJobUpdatedEmail =
        body.notificationSource === JOB_UPDATED_NOTIFICATION_SOURCE_OVERVIEW_EDIT;

      const deliveryDateChanges = changes.filter((c) => c.field === 'deliveryDate');

      if (changes.length > 0 && !shouldSendJobUpdatedEmail) {
        console.warn(
          `[update-info] job_updated_notification skipped: notificationSource is not '${JOB_UPDATED_NOTIFICATION_SOURCE_OVERVIEW_EDIT}' (jobNumber=${finalJobNumber} changeCount=${changes.length})`,
        );
      } else if (
        shouldSendJobUpdatedEmail &&
        changes.length > 0 &&
        deliveryDateChanges.length === 0
      ) {
        console.log(
          `[update-info] job_updated_notification skipped: delivery date unchanged (jobNumber=${finalJobNumber} otherChangeCount=${changes.length})`,
        );
      }

      if (shouldSendJobUpdatedEmail && deliveryDateChanges.length > 0) {
        const changeNoteText =
          typeof body.deliveryDateChangeNote === 'string'
            ? body.deliveryDateChangeNote.trim()
            : '';
        const noteCreatedBy =
          updatedByName?.trim() || updatedByEmailStr?.trim() || null;
        const createdNote = await prisma.jobNote.create({
          data: {
            jobNumber: finalJobNumber,
            listNumber: notifyListNumber,
            content: changeNoteText,
            createdBy: noteCreatedBy,
            noteKind: JOB_NOTE_KIND_DELIVERY_DATE_CHANGE,
            deliveryDateFrom: beforeJobRow?.deliveryDate ?? null,
            deliveryDateTo: afterJobRow?.deliveryDate ?? null,
          },
        });

        await sendJobUpdatedNotification(
          finalJobNumber,
          notifyListNumber,
          updatedJob.jobName ?? null,
          deliveryDateChanges,
          updatedByName,
          updatedByEmailStr,
          {
            changeNoteId: createdNote.id,
            changeNoteContent: changeNoteText,
            changeNoteCreatedBy: updatedByName,
          },
        );
      }
    } catch (notifyErr) {
      console.error('[update-info] job_updated_notification:', notifyErr);
    }

    return NextResponse.json({
      success: true,
      jobNumber: finalJobNumber,
      oldJobNumber: isJobNumberChanging ? normalizedJobNumber : undefined,
      listNumber: finalListNumber ?? undefined,
      jobName: updatedJob.jobName,
      lineItems: updatedJob.lineItems,
      jobMeta: updatedJob.jobMeta ?? null,
      accessReview: pendingTypeAccessImpact ?? undefined,
      editorLostAccessAfterSave: pendingTypeAccessImpact?.editorWouldLoseAccess === true,
    });
  } catch (error) {
    console.error('Error in /api/jobs/[jobNumber]/update-info:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
