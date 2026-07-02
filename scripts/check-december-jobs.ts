import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkDecemberJobs() {
  try {
    const jobs = await prisma.job.findMany({
      where: {
        jobNumber: {
          startsWith: 'DEC-',
        },
      },
      select: {
        jobNumber: true,
        jobName: true,
        stocklistDeliveryShipDate: true,
        pulled: true,
        quantityNeeded: true,
        ordered: true,
        delivered: true,
      },
      orderBy: {
        stocklistDeliveryShipDate: 'asc',
      },
    });

    console.log(`Found ${jobs.length} DEC jobs\n`);
    
    // Group by job number
    const jobGroups = new Map<string, typeof jobs>();
    for (const job of jobs) {
      if (!jobGroups.has(job.jobNumber)) {
        jobGroups.set(job.jobNumber, []);
      }
      jobGroups.get(job.jobNumber)!.push(job);
    }

    for (const [jobNumber, jobLines] of jobGroups.entries()) {
      const firstLine = jobLines[0];
      console.log(`Job: ${jobNumber}`);
      console.log(`  Name: ${firstLine.jobName}`);
      console.log(`  Date: ${firstLine.stocklistDeliveryShipDate}`);
      console.log(`  Lines: ${jobLines.length}`);
      jobLines.forEach(line => {
        console.log(`    - ${line.pulled}/${line.quantityNeeded} pulled, ordered: ${line.ordered}, delivered: ${line.delivered}`);
      });
      console.log('');
    }

    // Check what dates we have
    const dates = new Set(jobs.map(j => j.stocklistDeliveryShipDate?.toISOString().split('T')[0]).filter(Boolean));
    console.log('Dates found:', Array.from(dates).sort());
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkDecemberJobs();

