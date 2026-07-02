/**
 * Script to create 8 test jobs for December to test the calendar
 * Run with: npx ts-node scripts/create-december-test-jobs.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Helper to create a date in December 2024
function decDate(day: number): Date {
  return new Date(2024, 11, day); // Month 11 = December (0-indexed)
}

async function createDecemberTestJobs() {
  try {
    console.log('Creating 8 test jobs for December...\n');

    // Job 1: White status (Unmarked/New) - Dec 5
    await prisma.job.create({
      data: {
        jobNumber: 'DEC-001',
        jobName: 'New Installation Project - Office Building',
        partNumber: 'PIPE-001',
        quantityNeeded: 50,
        pulled: 0,
        stocklistDeliveryShipDate: decDate(5),
        description: 'Fire sprinkler pipes for new office building',
        type: 'Fab\'d',
        ordered: false,
        receivedFromOrder: false,
        delivered: false,
      },
    });
    await prisma.job.create({
      data: {
        jobNumber: 'DEC-001',
        jobName: 'New Installation Project - Office Building',
        partNumber: 'FITTING-001',
        quantityNeeded: 30,
        pulled: 0,
        stocklistDeliveryShipDate: decDate(5),
        description: 'Threaded fittings',
        type: 'Loose',
        ordered: false,
        receivedFromOrder: false,
        delivered: false,
      },
    });
    console.log('✅ Created DEC-001 (White - Unmarked) on Dec 5');

    // Job 2: Green status (Waiting to Pull) - Dec 8
    await prisma.job.create({
      data: {
        jobNumber: 'DEC-002',
        jobName: 'Retrofit Project - Warehouse',
        partNumber: 'PIPE-002',
        quantityNeeded: 75,
        pulled: 25,
        pulledBy: 'John Smith',
        pulledDate: decDate(1),
        stocklistDeliveryShipDate: decDate(8),
        description: 'CPVC pipes for warehouse retrofit',
        type: 'Shop',
        ordered: false,
        receivedFromOrder: false,
        delivered: false,
      },
    });
    await prisma.job.create({
      data: {
        jobNumber: 'DEC-002',
        jobName: 'Retrofit Project - Warehouse',
        partNumber: 'VALVE-001',
        quantityNeeded: 15,
        pulled: 5,
        pulledBy: 'John Smith',
        pulledDate: decDate(1),
        stocklistDeliveryShipDate: decDate(8),
        description: 'Control valves',
        type: 'Galloup',
        ordered: false,
        receivedFromOrder: false,
        delivered: false,
      },
    });
    console.log('✅ Created DEC-002 (Green - Waiting to Pull) on Dec 8');

    // Job 3: Yellow status (Back Orders) - Dec 12
    await prisma.job.create({
      data: {
        jobNumber: 'DEC-003',
        jobName: 'Residential Complex - Phase 2',
        partNumber: 'HEAD-001',
        quantityNeeded: 100,
        pulled: 0,
        stocklistDeliveryShipDate: decDate(12),
        description: 'Sprinkler heads - on backorder',
        type: 'Etna',
        ordered: true,
        receivedFromOrder: false,
        delivered: false,
      },
    });
    await prisma.job.create({
      data: {
        jobNumber: 'DEC-003',
        jobName: 'Residential Complex - Phase 2',
        partNumber: 'HANGER-001',
        quantityNeeded: 200,
        pulled: 0,
        stocklistDeliveryShipDate: decDate(12),
        description: 'Pipe hangers - waiting for shipment',
        type: 'Viking',
        ordered: true,
        receivedFromOrder: false,
        delivered: false,
      },
    });
    console.log('✅ Created DEC-003 (Yellow - Back Orders) on Dec 12');

    // Job 4: Blue status (Ready for Pickup) - Dec 15
    await prisma.job.create({
      data: {
        jobNumber: 'DEC-004',
        jobName: 'Commercial Building - Main Floor',
        partNumber: 'PIPE-003',
        quantityNeeded: 60,
        pulled: 60,
        pulledBy: 'Jane Doe',
        pulledDate: decDate(10),
        stocklistDeliveryShipDate: decDate(15),
        description: 'Steel pipes - all pulled and ready',
        type: 'Fab\'d',
        ordered: false,
        receivedFromOrder: false,
        delivered: false,
      },
    });
    await prisma.job.create({
      data: {
        jobNumber: 'DEC-004',
        jobName: 'Commercial Building - Main Floor',
        partNumber: 'NIPPLE-001',
        quantityNeeded: 40,
        pulled: 40,
        pulledBy: 'Jane Doe',
        pulledDate: decDate(10),
        stocklistDeliveryShipDate: decDate(15),
        description: 'Pipe nipples - ready',
        type: 'Loose',
        ordered: false,
        receivedFromOrder: false,
        delivered: false,
      },
    });
    console.log('✅ Created DEC-004 (Blue - Ready for Pickup) on Dec 15');

    // Job 5: Darker Blue status (Fitter Pickup) - Dec 18
    await prisma.job.create({
      data: {
        jobNumber: 'DEC-005',
        jobName: 'Hospital Wing Expansion',
        partNumber: 'PIPE-004',
        quantityNeeded: 120,
        pulled: 120,
        pulledBy: 'Mike Johnson',
        pulledDate: decDate(12),
        stocklistDeliveryShipDate: decDate(18),
        description: 'Medical grade pipes',
        type: 'Shop',
        ordered: false,
        receivedFromOrder: false,
        delivered: true,
      },
    });
    await prisma.job.create({
      data: {
        jobNumber: 'DEC-005',
        jobName: 'Hospital Wing Expansion',
        partNumber: 'FITTING-002',
        quantityNeeded: 80,
        pulled: 80,
        pulledBy: 'Mike Johnson',
        pulledDate: decDate(12),
        stocklistDeliveryShipDate: decDate(18),
        description: 'Grooved fittings',
        type: 'Core & Main',
        ordered: false,
        receivedFromOrder: false,
        delivered: true,
      },
    });
    console.log('✅ Created DEC-005 (Darker Blue - Fitter Pickup) on Dec 18');

    // Job 6: Mixed status - Dec 20
    await prisma.job.create({
      data: {
        jobNumber: 'DEC-006',
        jobName: 'Apartment Complex - Building A',
        partNumber: 'PIPE-005',
        quantityNeeded: 90,
        pulled: 45,
        pulledBy: 'Sarah Williams',
        pulledDate: decDate(15),
        stocklistDeliveryShipDate: decDate(20),
        description: 'Residential pipes',
        type: 'Fab\'d',
        ordered: false,
        receivedFromOrder: false,
        delivered: false,
      },
    });
    await prisma.job.create({
      data: {
        jobNumber: 'DEC-006',
        jobName: 'Apartment Complex - Building A',
        partNumber: 'HEAD-002',
        quantityNeeded: 150,
        pulled: 0,
        stocklistDeliveryShipDate: decDate(20),
        description: 'Residential sprinkler heads',
        type: 'Galloup',
        ordered: true,
        receivedFromOrder: false,
        delivered: false,
      },
    });
    console.log('✅ Created DEC-006 (Mixed status) on Dec 20');

    // Job 7: Late December - Dec 27
    await prisma.job.create({
      data: {
        jobNumber: 'DEC-007',
        jobName: 'Retail Store Renovation',
        partNumber: 'VALVE-002',
        quantityNeeded: 20,
        pulled: 0,
        stocklistDeliveryShipDate: decDate(27),
        description: 'Zone control valves',
        type: 'Etna',
        ordered: false,
        receivedFromOrder: false,
        delivered: false,
      },
    });
    await prisma.job.create({
      data: {
        jobNumber: 'DEC-007',
        jobName: 'Retail Store Renovation',
        partNumber: 'PIPE-006',
        quantityNeeded: 35,
        pulled: 10,
        pulledBy: 'Tom Brown',
        pulledDate: decDate(20),
        stocklistDeliveryShipDate: decDate(27),
        description: 'Flexible pipes',
        type: 'Viking',
        ordered: false,
        receivedFromOrder: false,
        delivered: false,
      },
    });
    console.log('✅ Created DEC-007 (Late December) on Dec 27');

    // Job 8: Year end - Dec 31
    await prisma.job.create({
      data: {
        jobNumber: 'DEC-008',
        jobName: 'End of Year Project - Factory',
        partNumber: 'PIPE-007',
        quantityNeeded: 200,
        pulled: 150,
        pulledBy: 'Lisa Anderson',
        pulledDate: decDate(25),
        stocklistDeliveryShipDate: decDate(31),
        description: 'Industrial grade pipes',
        type: 'Shop',
        ordered: false,
        receivedFromOrder: false,
        delivered: false,
      },
    });
    await prisma.job.create({
      data: {
        jobNumber: 'DEC-008',
        jobName: 'End of Year Project - Factory',
        partNumber: 'COMPRESSOR-001',
        quantityNeeded: 2,
        pulled: 2,
        pulledBy: 'Lisa Anderson',
        pulledDate: decDate(25),
        stocklistDeliveryShipDate: decDate(31),
        description: 'Air compressors',
        type: 'Core & Main',
        ordered: false,
        receivedFromOrder: false,
        delivered: true,
      },
    });
    console.log('✅ Created DEC-008 (Year End) on Dec 31');

    console.log('\n✅ Successfully created 8 test jobs for December!');
    console.log('Jobs created:');
    console.log('  - DEC-001: Dec 5 (White - Unmarked)');
    console.log('  - DEC-002: Dec 8 (Green - Waiting to Pull)');
    console.log('  - DEC-003: Dec 12 (Yellow - Back Orders)');
    console.log('  - DEC-004: Dec 15 (Blue - Ready for Pickup)');
    console.log('  - DEC-005: Dec 18 (Darker Blue - Fitter Pickup)');
    console.log('  - DEC-006: Dec 20 (Mixed status)');
    console.log('  - DEC-007: Dec 27 (Late December)');
    console.log('  - DEC-008: Dec 31 (Year End)');

  } catch (error) {
    console.error('❌ Error creating test jobs:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
    }
  } finally {
    await prisma.$disconnect();
  }
}

createDecemberTestJobs();

