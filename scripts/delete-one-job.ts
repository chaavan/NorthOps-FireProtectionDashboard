/**
 * Delete a single job by job number (and all related records).
 * Usage: npx tsx scripts/delete-one-job.ts "job number"
 * Example: npx tsx scripts/delete-one-job.ts "test notification"
 */
import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { deleteR2Object } from '../lib/r2';
import { deletePackingSlipObject } from '../lib/packingSlipsStorage';
import { purgePurchaseOrderLinesForJob } from '../lib/purchaseOrderJobPurge';

const jobNumber = process.argv[2]?.trim();
if (!jobNumber) {
  console.error('Usage: npx tsx scripts/delete-one-job.ts "job number"');
  process.exit(1);
}

async function main() {
  const count = await prisma.job.count({ where: { jobNumber } });
  if (count === 0) {
    console.log(`No job found with jobNumber: "${jobNumber}". Nothing to delete.`);
    process.exit(0);
  }

  console.log(`Deleting job "${jobNumber}" and all related records...`);

  const attachments = await prisma.jobNoteAttachment.findMany({
    where: { jobNumber },
    select: { r2Key: true },
  });
  for (const { r2Key } of attachments) {
    if (!r2Key) continue;
    try {
      await deleteR2Object({ key: r2Key });
    } catch (err) {
      console.warn('R2 delete skip:', r2Key, err);
    }
  }

  const packingRows = await prisma.packingSlipAttachment.findMany({
    where: { jobNumber },
    select: { storageKey: true },
  });
  for (const { storageKey } of packingRows) {
    if (!storageKey) continue;
    try {
      await deletePackingSlipObject(storageKey);
    } catch (err) {
      console.warn('Packing slip R2 delete skip:', storageKey, err);
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const poPurge = await purgePurchaseOrderLinesForJob(tx, jobNumber, null);

    const attachmentsDeleted = await tx.jobNoteAttachment.deleteMany({
      where: { jobNumber },
    });
    const notesDeleted = await tx.jobNote.deleteMany({ where: { jobNumber } });

    const [
      jobsDeleted,
      accessDeleted,
      notificationsDeleted,
      deliveriesDeleted,
      partAllocationsDeleted,
      inventoryMovementsDeleted,
      liveDeleted,
      estimatesDeleted,
      packingDeleted,
      jobImportsDeleted,
    ] = await Promise.all([
      tx.job.deleteMany({ where: { jobNumber } }),
      tx.jobAccess.deleteMany({ where: { jobNumber } }),
      tx.jobNotification.deleteMany({ where: { jobNumber } }),
      tx.delivery.deleteMany({ where: { jobNumber } }),
      tx.partAllocation.deleteMany({ where: { jobId: jobNumber } }),
      tx.inventoryMovement.deleteMany({
        where: {
          OR: [
            { contextType: 'JOB', contextId: jobNumber },
            { contextType: 'job', contextId: jobNumber },
          ],
        },
      }),
      tx.jobLiveViewSession.deleteMany({ where: { jobNumber } }),
      tx.estimate.deleteMany({ where: { jobNumber } }),
      tx.packingSlipAttachment.deleteMany({ where: { jobNumber } }),
      tx.jobImport.deleteMany({
        where: {
          OR: [{ targetJobNumber: jobNumber }, { committedJobNumber: jobNumber }],
        },
      }),
    ]);

    return {
      jobsDeleted,
      attachmentsDeleted,
      notesDeleted,
      accessDeleted,
      notificationsDeleted,
      deliveriesDeleted,
      partAllocationsDeleted,
      inventoryMovementsDeleted,
      liveDeleted,
      estimatesDeleted,
      packingDeleted,
      jobImportsDeleted,
      poPurge,
    };
  });

  console.log('Done. Deleted:');
  console.log('  jobs:', result.jobsDeleted.count);
  console.log('  note attachments:', result.attachmentsDeleted.count);
  console.log('  notes:', result.notesDeleted.count);
  console.log('  job access:', result.accessDeleted.count);
  console.log('  notifications:', result.notificationsDeleted.count);
  console.log('  deliveries:', result.deliveriesDeleted.count);
  console.log('  estimates:', result.estimatesDeleted.count);
  console.log('  packing slips:', result.packingDeleted.count);
  console.log('  job imports:', result.jobImportsDeleted.count);
  console.log('  job live view sessions:', result.liveDeleted.count);
  console.log('  part allocations:', result.partAllocationsDeleted.count);
  console.log('  inventory movements:', result.inventoryMovementsDeleted.count);
  console.log('  purchase orders removed:', result.poPurge.purchaseOrdersDeleted);
  console.log('  purchase orders trimmed:', result.poPurge.purchaseOrdersUpdated);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
