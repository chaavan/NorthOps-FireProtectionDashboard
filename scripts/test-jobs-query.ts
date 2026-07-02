import { getAllJobsFromDatabase, getJobListFromDatabase, getJobLinesFromDatabase } from '../lib/jobsDatabase';

async function testJobsQuery() {
  try {
    console.log('='.repeat(80));
    console.log('Testing Jobs Database Queries');
    console.log('='.repeat(80));
    
    // Test 1: Get all jobs
    console.log('\n1. Testing getAllJobsFromDatabase()...');
    const allJobs = await getAllJobsFromDatabase();
    console.log(`✅ Found ${allJobs.length} total job line items`);
    if (allJobs.length > 0) {
      console.log('\nFirst 3 jobs:');
      allJobs.slice(0, 3).forEach((job, idx) => {
        console.log(`  ${idx + 1}. Job: ${job.jobNumber} - ${job.jobName}`);
        console.log(`     Part: ${job.partNumber}, Qty Needed: ${job.quantityNeeded}, Pulled: ${job.quantityPulled}`);
      });
    }

    // Test 2: Get job list (unique jobs with summary)
    console.log('\n2. Testing getJobListFromDatabase()...');
    const jobList = await getJobListFromDatabase();
    console.log(`✅ Found ${jobList.jobs.length} unique jobs`);
    if (jobList.jobs.length > 0) {
      console.log('\nFirst 5 jobs:');
      jobList.jobs.slice(0, 5).forEach((job, idx) => {
        console.log(`  ${idx + 1}. ${job.jobNumber} - ${job.jobName}`);
        console.log(`     Line Items: ${job.lineCount}, Fully Pulled: ${job.pulledCount}`);
      });
    }

    // Test 3: Get specific job lines
    if (jobList.jobs.length > 0) {
      const testJobNumber = jobList.jobs[0].jobNumber;
      console.log(`\n3. Testing getJobLinesFromDatabase("${testJobNumber}")...`);
      const jobDetails = await getJobLinesFromDatabase(testJobNumber);
      console.log(`✅ Found ${jobDetails.lineItems.length} line items for job ${testJobNumber}`);
      console.log(`   Job Name: ${jobDetails.jobName}`);
      if (jobDetails.lineItems.length > 0) {
        console.log('\nFirst 3 line items:');
        jobDetails.lineItems.slice(0, 3).forEach((item, idx) => {
          console.log(`  ${idx + 1}. Part: ${item.partNumber || 'N/A'}`);
          console.log(`     Description: ${item.description || 'N/A'}`);
          console.log(`     Qty Needed: ${item.quantityNeeded}, Pulled: ${item.quantityPulled}`);
          console.log(`     Ordered: ${item.ordered || 'N/A'}, Type: ${item.type || 'N/A'}`);
        });
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ All tests completed successfully!');
    console.log('='.repeat(80));
  } catch (error) {
    console.error('❌ Error testing jobs query:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
}

testJobsQuery();

