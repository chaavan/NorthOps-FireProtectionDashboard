/**
 * Script to create a test job
 * Run with: npx ts-node scripts/create-test-job.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createTestJob() {
  try {
    // Create a test job with a part
    const job = await prisma.job.create({
      data: {
        jobNumber: 'TEST-001',
        jobName: 'Test Job',
        partNumber: 'TEST-PART-001',
        quantityNeeded: 10,
        pulled: 0,
        stocklistDeliveryShipDate: new Date('2024-12-31'),
        description: 'This is a test job created for testing purposes',
      },
    });

    console.log('✅ Test job created successfully!');
    console.log('Job details:', {
      jobNumber: job.jobNumber,
      jobName: job.jobName,
      partNumber: job.partNumber,
      quantityNeeded: job.quantityNeeded,
      stocklistDeliveryShipDate: job.stocklistDeliveryShipDate,
    });
  } catch (error) {
    console.error('❌ Error creating test job:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
    }
  } finally {
    await prisma.$disconnect();
  }
}

createTestJob();




