/**
 * Script to clear all inventory data (parts and audit log).
 * This will:
 * 1. Delete all InventoryMovement records (audit log)
 * 2. Delete all PartAllocation records (job–part pull quantities)
 * 3. Delete all Part records (part numbers / inventory)
 *
 * WARNING: This is a destructive operation and cannot be undone!
 * Run with: npx tsx scripts/clear-inventory.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function clearInventory() {
  try {
    console.log('🚨 Starting inventory cleanup...\n');

    // Step 1: Delete all InventoryMovement (audit log)
    console.log('📋 Step 1: Deleting all InventoryMovement records (audit log)...');
    const movementCount = await prisma.inventoryMovement.count();
    const deletedMovements = await prisma.inventoryMovement.deleteMany({});
    console.log(`   ✅ Deleted ${deletedMovements.count} of ${movementCount} InventoryMovement records\n`);

    // Step 2: Delete all PartAllocation (job–part links)
    console.log('🔗 Step 2: Deleting all PartAllocation records...');
    const allocationCount = await prisma.partAllocation.count();
    const deletedAllocations = await prisma.partAllocation.deleteMany({});
    console.log(`   ✅ Deleted ${deletedAllocations.count} of ${allocationCount} PartAllocation records\n`);

    // Step 3: Delete all Part records (part numbers / inventory)
    console.log('📦 Step 3: Deleting all Part records (part numbers)...');
    const partCount = await prisma.part.count();
    const deletedParts = await prisma.part.deleteMany({});
    console.log(`   ✅ Deleted ${deletedParts.count} of ${partCount} Part records\n`);

    // Summary
    console.log('✅ Inventory cleanup completed successfully!');
    console.log('\n📊 Summary:');
    console.log(`   - InventoryMovement (audit log) deleted: ${deletedMovements.count}`);
    console.log(`   - PartAllocation deleted: ${deletedAllocations.count}`);
    console.log(`   - Part records deleted: ${deletedParts.count}`);
    console.log('\n✨ All inventory and audit log data has been cleared.');
  } catch (error) {
    console.error('❌ Error during inventory cleanup:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

console.log('⚠️  WARNING: This script will DELETE ALL inventory data!');
console.log('   - All InventoryMovement records (audit log)');
console.log('   - All PartAllocation records (job–part pull quantities)');
console.log('   - All Part records (part numbers / inventory)');
console.log('\n   This operation CANNOT be undone!\n');

clearInventory();
