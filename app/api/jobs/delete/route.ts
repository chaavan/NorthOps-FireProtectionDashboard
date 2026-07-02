import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { MovementType } from '@prisma/client';
import { authOptions, resolveSessionUserIdForAudit } from '@/lib/auth';
import { getEffectivePermissionsForSession } from '@/lib/permissions';
import { bypassesJobAccessList } from '@/lib/jobScopedAccess';
import { prisma } from '@/lib/prisma';
import { cache, cacheKeys } from '@/lib/cache';
import { deleteR2Object } from '@/lib/r2';
import { deletePackingSlipObject } from '@/lib/packingSlipsStorage';
import { partNumberLookupVariants } from '@/lib/inventoryQuantity';
import { findPartRowByLookupVariants } from '@/lib/partsDatabase';
import { JOB_CONTEXT_TYPE, recordOperationalDelta } from '@/lib/inventoryLedger';
import { getJobStockBackSummary } from '@/lib/jobStockBack';
import { purgePurchaseOrderLinesForJob } from '@/lib/purchaseOrderJobPurge';

// Force this route to be dynamic
export const dynamic = 'force-dynamic';

/**
 * POST /api/jobs/delete
 * Deletes job line items. When listNumber is provided, deletes that list's lines and list-scoped tab data.
 * When listNumber is omitted, deletes the entire job and ALL related records:
 * - Job rows (all lists)
 * - Notes and note attachments (including R2 objects)
 * - Job access
 * - Job notifications
 * - Deliveries and delivery locations
 * - Packing slip rows and packing-slip R2 objects
 * - Purchase order rows that only contained this job's lines; otherwise strips this job's lines from PO JSON
 * - Job import sessions targeted at or committed to this job
 * - Part allocations
 * - Inventory movements for this job are retained (immutable audit).
 *
 * When listNumber is provided, deletes that list's line items and the same tab-scoped data for that list only
 * (delivery, access, notes, packing slips, PO lines for that list). Job-wide
 * notifications are kept until the full job is deleted.
 *
 * Request body:
 * {
 *   jobNumber: string,
 *   listNumber?: string,      // When provided, delete this list's lines and list-scoped tab data
 *   addBackInventory?: boolean // When deleting entire job: if true, unpull job allocations back into inventory before deletion
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
    const permissionDetails = await getEffectivePermissionsForSession(session);
    if (!bypassesJobAccessList(role, permissionDetails)) {
      return NextResponse.json(
        { error: 'Forbidden - Admin access required to delete jobs' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const jobNumber = body?.jobNumber?.trim();
    const listNumber = body?.listNumber?.trim();
    const addBackInventory: boolean = body?.addBackInventory === true;

    if (!jobNumber) {
      return NextResponse.json(
        { error: 'jobNumber is required' },
        { status: 400 }
      );
    }

    const actorUserId = await resolveSessionUserIdForAudit(session);

    if (listNumber) {
      const listNoteAttachments = await prisma.jobNoteAttachment.findMany({
        where: { jobNumber, listNumber },
        select: { r2Key: true },
      });
      for (const { r2Key } of listNoteAttachments) {
        if (!r2Key) continue;
        try {
          await deleteR2Object({ key: r2Key });
        } catch (err) {
          console.error(
            `Failed to delete R2 note attachment for job ${jobNumber} list ${listNumber}, key: ${r2Key}`,
            err,
          );
        }
      }

      const listPackingSlips = await prisma.packingSlipAttachment.findMany({
        where: { jobNumber, listNumber },
        select: { storageKey: true },
      });
      for (const { storageKey } of listPackingSlips) {
        if (!storageKey) continue;
        try {
          await deletePackingSlipObject(storageKey);
        } catch (err) {
          console.error(
            `Failed to delete packing slip R2 for job ${jobNumber} list ${listNumber}, key: ${storageKey}`,
            err,
          );
        }
      }

      const listDeleteResult = await prisma.$transaction(async (tx) => {
        const listLines = await tx.job.findMany({
          where: { jobNumber, listNumber },
          select: {
            partNumber: true,
            pulled: true,
          },
        });

        const pulledByPart = new Map<string, number>();
        for (const line of listLines) {
          const pulled = line.pulled ?? 0;
          if (!line.partNumber || pulled <= 0) continue;
          const existing = pulledByPart.get(line.partNumber) ?? 0;
          pulledByPart.set(line.partNumber, existing + pulled);
        }

        for (const [partNumber, pulledQty] of pulledByPart.entries()) {
          const variants = partNumberLookupVariants(partNumber);
          const part = await findPartRowByLookupVariants(variants, tx);
          if (!part) continue;

          await recordOperationalDelta(tx, {
            partId: part.id,
            signedDelta: pulledQty,
            movementType: MovementType.UNPULL,
            contextType: JOB_CONTEXT_TYPE,
            contextId: jobNumber,
            actorUserId,
            note: `Auto-unpull on list delete (${listNumber})`,
          });

          const existingAllocation = await tx.partAllocation.findUnique({
            where: {
              partId_jobId: {
                partId: part.id,
                jobId: jobNumber,
              },
            },
            select: { id: true, quantityPulled: true },
          });

          if (existingAllocation) {
            const nextAllocation = Math.max(0, existingAllocation.quantityPulled - pulledQty);
            await tx.partAllocation.update({
              where: { id: existingAllocation.id },
              data: { quantityPulled: nextAllocation },
            });
          }
        }

        const poPurge = await purgePurchaseOrderLinesForJob(tx, jobNumber, listNumber);

        const attachmentsDeleted = await tx.jobNoteAttachment.deleteMany({
          where: { jobNumber, listNumber },
        });
        const notesDeleted = await tx.jobNote.deleteMany({
          where: { jobNumber, listNumber },
        });

        const [
          jobsDeleted,
          accessDeleted,
          deliveriesDeleted,
          packingDeleted,
          liveDeleted,
        ] = await Promise.all([
          tx.job.deleteMany({ where: { jobNumber, listNumber } }),
          tx.jobAccess.deleteMany({ where: { jobNumber, listNumber } }),
          tx.delivery.deleteMany({ where: { jobNumber, listNumber } }),
          tx.packingSlipAttachment.deleteMany({ where: { jobNumber, listNumber } }),
          tx.jobLiveViewSession.deleteMany({ where: { jobNumber, listNumber } }),
        ]);

        return {
          jobsDeleted,
          notesDeleted,
          attachmentsDeleted,
          accessDeleted,
          deliveriesDeleted,
          packingDeleted,
          liveDeleted,
          poPurge,
        };
      });

      cache.delete(cacheKeys.jobDetails(jobNumber, listNumber));
      cache.delete(cacheKeys.delivery(jobNumber, listNumber));
      cache.delete(cacheKeys.jobsList());
      cache.delete(cacheKeys.calendar());

      return NextResponse.json({
        success: true,
        jobNumber,
        listNumber,
        deletedListOnly: true,
        counts: {
          jobs: listDeleteResult.jobsDeleted.count,
          notes: listDeleteResult.notesDeleted.count,
          noteAttachments: listDeleteResult.attachmentsDeleted.count,
          jobAccess: listDeleteResult.accessDeleted.count,
          notifications: 0,
          deliveries: listDeleteResult.deliveriesDeleted.count,
          packingSlips: listDeleteResult.packingDeleted.count,
          jobLiveViewSessions: listDeleteResult.liveDeleted.count,
          purchaseOrdersUpdated: listDeleteResult.poPurge.purchaseOrdersUpdated,
          purchaseOrdersDeleted: listDeleteResult.poPurge.purchaseOrdersDeleted,
        },
      });
    }

    // Delete entire job and related records
    // First: delete R2 objects for this job's note attachments
    const attachments = await prisma.jobNoteAttachment.findMany({
      where: { jobNumber },
      select: { r2Key: true },
    });

    let r2Deleted = 0;
    for (const { r2Key } of attachments) {
      if (!r2Key) continue;
      try {
        await deleteR2Object({ key: r2Key });
        r2Deleted += 1;
      } catch (err) {
        console.error(
          `⚠️ Failed to delete R2 object for job ${jobNumber}, key: ${r2Key}`,
          err
        );
      }
    }
    if (attachments.length > 0) {
      console.log(
        `🧹 Deleted ${r2Deleted} R2 object(s) for note attachments on job ${jobNumber}`
      );
    }

    const packingRows = await prisma.packingSlipAttachment.findMany({
      where: { jobNumber },
      select: { storageKey: true },
    });
    let packingR2Deleted = 0;
    for (const { storageKey } of packingRows) {
      if (!storageKey) continue;
      try {
        await deletePackingSlipObject(storageKey);
        packingR2Deleted += 1;
      } catch (err) {
        console.error(
          `Failed to delete packing slip R2 for job ${jobNumber}, key: ${storageKey}`,
          err,
        );
      }
    }
    if (packingRows.length > 0) {
      console.log(
        `Deleted ${packingR2Deleted} packing slip R2 object(s) for job ${jobNumber}`,
      );
    }

    // Then: adjust inventory (if requested) and delete DB records for this job in a transaction
    const {
      jobsDeleted,
      attachmentsDeleted,
      notesDeleted,
      accessDeleted,
      notificationsDeleted,
      deliveriesDeleted,
      partAllocationsDeleted,
      jobLiveViewSessionsDeleted,
      packingSlipsDeleted,
      jobImportsDeleted,
      purchaseOrdersUpdated,
      purchaseOrdersDeleted,
      unpulledCount,
    } = await prisma.$transaction(async (tx) => {
      let unpulledTotal = 0;

      if (addBackInventory) {
        const stockBackSummary = await getJobStockBackSummary(tx, jobNumber);

        for (const part of stockBackSummary.parts) {
          if (!part.partId || part.remainingReturnableQuantity <= 0) continue;

          await recordOperationalDelta(tx, {
            partId: part.partId,
            signedDelta: part.remainingReturnableQuantity,
            movementType: MovementType.UNPULL,
            contextType: JOB_CONTEXT_TYPE,
            contextId: jobNumber,
            actorUserId,
            note: 'Auto-unpull on job delete (remaining stock-back eligible material)',
          });

          unpulledTotal += part.remainingReturnableQuantity;
        }
      }

      const poPurge = await purgePurchaseOrderLinesForJob(tx, jobNumber, null);

      const attachmentsDeletedTx = await tx.jobNoteAttachment.deleteMany({
        where: { jobNumber },
      });
      const notesDeletedTx = await tx.jobNote.deleteMany({ where: { jobNumber } });

      const [
        jobsDeletedTx,
        accessDeletedTx,
        notificationsDeletedTx,
        deliveriesDeletedTx,
        partAllocationsDeletedTx,
        jobLiveViewSessionsDeletedTx,
        packingSlipsDeletedTx,
        jobImportsDeletedTx,
      ] = await Promise.all([
        tx.job.deleteMany({ where: { jobNumber } }),
        tx.jobAccess.deleteMany({ where: { jobNumber } }),
        tx.jobNotification.deleteMany({ where: { jobNumber } }),
        tx.delivery.deleteMany({ where: { jobNumber } }),
        tx.partAllocation.deleteMany({ where: { jobId: jobNumber } }),
        tx.jobLiveViewSession.deleteMany({ where: { jobNumber } }),
        tx.packingSlipAttachment.deleteMany({ where: { jobNumber } }),
        tx.jobImport.deleteMany({
          where: {
            OR: [{ targetJobNumber: jobNumber }, { committedJobNumber: jobNumber }],
          },
        }),
      ]);

      return {
        jobsDeleted: jobsDeletedTx,
        attachmentsDeleted: attachmentsDeletedTx,
        notesDeleted: notesDeletedTx,
        accessDeleted: accessDeletedTx,
        notificationsDeleted: notificationsDeletedTx,
        deliveriesDeleted: deliveriesDeletedTx,
        partAllocationsDeleted: partAllocationsDeletedTx,
        jobLiveViewSessionsDeleted: jobLiveViewSessionsDeletedTx,
        packingSlipsDeleted: packingSlipsDeletedTx,
        jobImportsDeleted: jobImportsDeletedTx,
        purchaseOrdersUpdated: poPurge.purchaseOrdersUpdated,
        purchaseOrdersDeleted: poPurge.purchaseOrdersDeleted,
        unpulledCount: unpulledTotal,
      };
    });

    cache.deletePattern(`^jobs:${jobNumber}:`);
    cache.deletePattern(`^delivery:${jobNumber}:`);
    cache.delete(cacheKeys.jobsList());
    cache.delete(cacheKeys.calendar());

    return NextResponse.json({
      success: true,
      jobNumber,
      counts: {
        jobs: jobsDeleted.count,
        notes: notesDeleted.count,
        noteAttachments: attachmentsDeleted.count,
        jobAccess: accessDeleted.count,
        notifications: notificationsDeleted.count,
        deliveries: deliveriesDeleted.count,
        packingSlips: packingSlipsDeleted.count,
        jobImports: jobImportsDeleted.count,
        partAllocations: partAllocationsDeleted.count,
        jobLiveViewSessions: jobLiveViewSessionsDeleted.count,
        purchaseOrdersUpdated,
        purchaseOrdersDeleted,
        r2NoteAttachmentsDeleted: r2Deleted,
        r2PackingSlipsDeleted: packingR2Deleted,
        inventoryUnitsUnpulled: unpulledCount,
      },
    });
  } catch (error) {
    console.error('Error in /api/jobs/delete:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
