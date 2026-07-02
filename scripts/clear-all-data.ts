/**
 * Script to clear all order and job data
 * This will:
 * 1. Delete all PurchaseOrders (order history)
 * 2. Clear all order-related fields from Jobs
 * 3. Delete all job-related notes, attachments (including R2 objects), and access records
 * 4. Delete all Jobs data
 * 
 * WARNING: This is a destructive operation and cannot be undone!
 * Run with: npx ts-node scripts/clear-all-data.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { deleteR2Object } from '../lib/r2';

const prisma = new PrismaClient();

async function clearAllData() {
  try {
    console.log('🚨 Starting data cleanup...\n');

    // Step 1: Delete all PurchaseOrders (Order History)
    console.log('📦 Step 1: Deleting all PurchaseOrders (Order History)...');
    const purchaseOrderCount = await prisma.purchaseOrder.count();
    const deletedPurchaseOrders = await prisma.purchaseOrder.deleteMany({});
    console.log(`   ✅ Deleted ${deletedPurchaseOrders.count} of ${purchaseOrderCount} PurchaseOrders\n`);

    // Step 2: Clear order-related fields from Jobs
    console.log('🔄 Step 2: Clearing order-related fields from Jobs...');
    const jobsWithOrders = await prisma.job.count({
      where: {
        OR: [
          { ordered: true },
          { receivedFromOrder: true },
          { quantityOrdered: { not: null } },
          { quantityReceivedFromOrder: { gt: 0 } },
        ],
      },
    });
    
    const updatedJobs = await prisma.job.updateMany({
      data: {
        ordered: false,
        receivedFromOrder: false,
        quantityOrdered: null,
        quantityReceivedFromOrder: 0,
        updatedAt: new Date(),
      },
    });
    console.log(`   ✅ Cleared order fields from ${updatedJobs.count} jobs (${jobsWithOrders} had order data)\n`);

    // Step 3: Delete all job-related notes, attachments (including R2 objects), and access records
    console.log('🧹 Step 3: Deleting job notes, attachments (R2), and access records...');

    // 3a: Delete R2 objects for all note attachments
    const attachmentKeys = await prisma.jobNoteAttachment.findMany({
      select: { r2Key: true },
    });
    console.log(`   🔍 Found ${attachmentKeys.length} note attachment(s) with R2 objects to delete...`);

    let r2Deleted = 0;
    for (const { r2Key } of attachmentKeys) {
      if (!r2Key) continue;
      try {
        await deleteR2Object({ key: r2Key });
        r2Deleted += 1;
      } catch (err) {
        console.error(`   ⚠️ Failed to delete R2 object for key: ${r2Key}`, err);
      }
    }
    console.log(`   ✅ Deleted ${r2Deleted} R2 object(s) for note attachments\n`);

    // 3b: Delete attachment records
    const deletedAttachments = await prisma.jobNoteAttachment.deleteMany({});
    console.log(`   ✅ Deleted ${deletedAttachments.count} JobNoteAttachment record(s)\n`);

    // 3c: Delete notes
    const deletedNotes = await prisma.jobNote.deleteMany({});
    console.log(`   ✅ Deleted ${deletedNotes.count} JobNote record(s)\n`);

    // 3d: Delete job access records
    const deletedAccess = await prisma.jobAccess.deleteMany({});
    console.log(`   ✅ Deleted ${deletedAccess.count} JobAccess record(s)\n`);

    // 3e: Delete job notifications
    const deletedJobNotifications = await prisma.jobNotification.deleteMany({});
    console.log(`   ✅ Deleted ${deletedJobNotifications.count} JobNotification record(s)\n`);

    // 3f: Delete job-related deliveries (locations will cascade)
    const deletedDeliveries = await prisma.delivery.deleteMany({});
    console.log(`   ✅ Deleted ${deletedDeliveries.count} Delivery record(s) (and related DeliveryLocation records via cascade)\n`);

    // 3g: Delete part allocations and job-related inventory movements
    const deletedPartAllocations = await prisma.partAllocation.deleteMany({});
    console.log(`   ✅ Deleted ${deletedPartAllocations.count} PartAllocation record(s)\n`);

    const deletedJobInventoryMovements = await prisma.inventoryMovement.deleteMany({
      where: {
        OR: [
          { contextType: 'JOB' },
          { contextType: 'job' },
        ],
      },
    });
    console.log(`   ✅ Deleted ${deletedJobInventoryMovements.count} InventoryMovement record(s) with contextType=JOB\n`);

    // Step 4: Delete all Jobs data
    console.log('🗑️  Step 4: Deleting all Jobs data...');
    const totalJobsCount = await prisma.job.count();
    const deletedJobs = await prisma.job.deleteMany({});
    console.log(`   ✅ Deleted ${deletedJobs.count} of ${totalJobsCount} Jobs\n`);

    // Summary
    console.log('✅ Data cleanup completed successfully!');
    console.log('\n📊 Summary:');
    console.log(`   - PurchaseOrders deleted: ${deletedPurchaseOrders.count}`);
    console.log(`   - Jobs order fields cleared: ${updatedJobs.count}`);
    console.log(`   - R2 objects deleted for note attachments: ${r2Deleted}`);
    console.log(`   - JobNoteAttachment records deleted: ${deletedAttachments.count}`);
    console.log(`   - JobNote records deleted: ${deletedNotes.count}`);
    console.log(`   - JobAccess records deleted: ${deletedAccess.count}`);
    console.log(`   - JobNotification records deleted: ${deletedJobNotifications.count}`);
    console.log(`   - Delivery records deleted (locations cascade): ${deletedDeliveries.count}`);
    console.log(`   - PartAllocation records deleted: ${deletedPartAllocations.count}`);
    console.log(`   - InventoryMovement records deleted with contextType=JOB: ${deletedJobInventoryMovements.count}`);
    console.log(`   - Jobs deleted: ${deletedJobs.count}`);
    console.log('\n✨ All data has been cleared. The system is ready for a fresh start!');
  } catch (error) {
    console.error('❌ Error during data cleanup:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Confirm before running
console.log('⚠️  WARNING: This script will DELETE ALL data!');
console.log('   - All PurchaseOrders (Order History)');
console.log('   - All order-related fields from Jobs');
console.log('   - All job notes, note attachments (including R2 objects), job access records, and job notifications');
console.log('   - All deliveries and delivery locations');
console.log('   - All part allocations and job-scoped inventory movements (contextType=JOB)');
console.log('   - ALL Jobs data');
console.log('\n   This operation CANNOT be undone!\n');

// Run the cleanup
clearAllData();
