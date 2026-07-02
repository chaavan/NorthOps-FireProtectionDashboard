import { prisma } from '../lib/prisma';

/**
 * Script to set deliveryDate to today for all jobs that don't have a delivery date
 * Uses raw SQL to avoid Prisma client schema issues
 */
async function setMissingDeliveryDates() {
  try {
    console.log('🔍 Setting delivery dates to today for jobs without delivery dates...');
    
    // Use raw SQL to update delivery_date to today
    // This works even if the Prisma client hasn't been regenerated
    const updateResult = await prisma.$executeRaw`
      UPDATE "jobs"
      SET "delivery_date" = DATE_TRUNC('day', CURRENT_TIMESTAMP)
      WHERE "delivery_date" IS NULL 
         OR "delivery_date" > CURRENT_TIMESTAMP + INTERVAL '10 years'
    `;

    console.log(`✅ Updated ${updateResult} job records`);

    // Get summary
    const summary = await prisma.$queryRaw<Array<{
      total_jobs: bigint;
      jobs_with_today: bigint;
      earliest_date: Date | null;
      latest_date: Date | null;
    }>>`
      SELECT 
        COUNT(*) as total_jobs,
        COUNT(CASE WHEN "delivery_date"::date = CURRENT_DATE THEN 1 END) as jobs_with_today,
        MIN("delivery_date"::date) as earliest_date,
        MAX("delivery_date"::date) as latest_date
      FROM "jobs"
    `;

    if (summary.length > 0) {
      const stats = summary[0];
      console.log(`\n📊 Summary:`);
      console.log(`   Total jobs: ${stats.total_jobs}`);
      console.log(`   Jobs with today's delivery date: ${stats.jobs_with_today}`);
      console.log(`   Earliest delivery date: ${stats.earliest_date ? new Date(stats.earliest_date).toISOString().split('T')[0] : 'N/A'}`);
      console.log(`   Latest delivery date: ${stats.latest_date ? new Date(stats.latest_date).toISOString().split('T')[0] : 'N/A'}`);
    }

    console.log(`\n✅ Successfully updated delivery dates!`);
  } catch (error) {
    console.error('❌ Error setting missing delivery dates:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
setMissingDeliveryDates()
  .then(() => {
    console.log('\n✨ Script completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script failed:', error);
    process.exit(1);
  });
