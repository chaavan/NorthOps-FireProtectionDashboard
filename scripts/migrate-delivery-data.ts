/**
 * Migration script to import delivery data from Google Sheets to database
 * Run with: npx tsx scripts/migrate-delivery-data.ts
 */

import { prisma } from '../lib/prisma';
import { getAllDeliveryRecords as getAllDeliveryRecordsFromSheets } from '../lib/deliverySheets';
import { updateDeliveryRecord } from '../lib/deliveryDatabase';

async function migrateDeliveryData() {
  console.log('🚀 Starting delivery data migration from Google Sheets to database...\n');

  try {
    // Get all delivery records from Google Sheets
    console.log('📥 Fetching delivery records from Google Sheets...');
    const deliveryRecords = await getAllDeliveryRecordsFromSheets();
    console.log(`✅ Found ${deliveryRecords.length} delivery records in Google Sheets\n`);

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    for (const record of deliveryRecords) {
      try {
        if (!record.jobNumber) {
          console.log(`⚠️  Skipping record without job number`);
          skippedCount++;
          continue;
        }

        // Check if record already exists in database
        const existing = await prisma.delivery.findUnique({
          where: { jobNumber: record.jobNumber },
        });

        if (existing) {
          console.log(`⏭️  Skipping ${record.jobNumber} - already exists in database`);
          skippedCount++;
          continue;
        }

        // Import the record
        console.log(`📝 Importing ${record.jobNumber}...`);
        await updateDeliveryRecord(record.jobNumber, record);
        successCount++;
        console.log(`✅ Imported ${record.jobNumber}`);
      } catch (error) {
        console.error(`❌ Error importing ${record.jobNumber}:`, error);
        errorCount++;
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`   ✅ Successfully imported: ${successCount}`);
    console.log(`   ⏭️  Skipped (already exists): ${skippedCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   📦 Total processed: ${deliveryRecords.length}\n`);

    console.log('🎉 Migration complete!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the migration
migrateDeliveryData();

