import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createJobsTable() {
  try {
    // Create table
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "jobs" (
        "job_number" TEXT NOT NULL,
        "job_name" TEXT NOT NULL,
        "contract_number" TEXT,
        "list_number" TEXT,
        "area" TEXT,
        "location_ship_to" TEXT,
        "stocklist_delivery_ship_date" TIMESTAMP(3),
        "unit_of_measurement" TEXT,
        "pulled" INTEGER NOT NULL DEFAULT 0,
        "quantity_needed" INTEGER NOT NULL,
        "pulled_by" TEXT,
        "pulled_date" TIMESTAMP(3),
        "description" TEXT,
        "ordered" BOOLEAN DEFAULT false,
        "received_from_order" BOOLEAN DEFAULT false,
        "delivered" BOOLEAN DEFAULT false,
        "part_number" TEXT NOT NULL,
        "type" TEXT,
        "part_type" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "jobs_pkey" PRIMARY KEY ("job_number", "part_number")
      )
    `);
    console.log('✅ Jobs table created');

    // Create indexes
    try {
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "jobs_job_number_idx" ON "jobs"("job_number")`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "jobs_part_number_idx" ON "jobs"("part_number")`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "jobs_job_name_idx" ON "jobs"("job_name")`);
      console.log('✅ Indexes created');
    } catch (indexError) {
      console.log('ℹ️  Indexes may already exist, continuing...');
    }

    console.log('✅ Jobs table setup complete!');
  } catch (error) {
    console.error('❌ Error creating jobs table:', error);
    if (error instanceof Error) {
      // If table already exists, that's okay
      if (error.message.includes('already exists')) {
        console.log('ℹ️  Jobs table already exists, continuing...');
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  } finally {
    await prisma.$disconnect();
  }
}

createJobsTable();

