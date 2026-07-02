/**
 * Migration script to migrate existing single location data to multiple locations
 * Run this after deploying the schema changes
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function migrateDeliveryLocations() {
  console.log("Starting migration of delivery locations...");

  try {
    // Find all deliveries that have old location data but no new locations
    const deliveries = await prisma.delivery.findMany({
      include: {
        locations: true,
      },
    });

    let migratedCount = 0;
    let skippedCount = 0;

    for (const delivery of deliveries) {
      // Skip if already has new locations
      if (delivery.locations && delivery.locations.length > 0) {
        console.log(`Skipping ${delivery.jobNumber} - already has locations`);
        skippedCount++;
        continue;
      }

      // Check if there's old location data
      const hasOldLocationData =
        delivery.location ||
        delivery.locationRow ||
        delivery.locationColumn;

      if (!hasOldLocationData) {
        console.log(
          `Skipping ${delivery.jobNumber} - no location data to migrate`,
        );
        skippedCount++;
        continue;
      }

      // Create a new location entry from old data
      await prisma.deliveryLocation.create({
        data: {
          deliveryId: delivery.id,
          locationType: delivery.location,
          row: delivery.locationRow,
          column: delivery.locationColumn,
          order: 0,
        },
      });

      console.log(`✓ Migrated location for ${delivery.jobNumber}`);
      migratedCount++;
    }

    console.log("\n=== Migration Summary ===");
    console.log(`Total deliveries: ${deliveries.length}`);
    console.log(`Migrated: ${migratedCount}`);
    console.log(`Skipped: ${skippedCount}`);
    console.log("Migration complete!");
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration
migrateDeliveryLocations()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
