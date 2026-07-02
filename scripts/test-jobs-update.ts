import { getJobLinesFromDatabase, updateJobLinesFromDatabase } from '../lib/jobsDatabase';
import type { LineItemUpdate } from '../lib/types';

async function testJobsUpdate() {
  try {
    console.log('='.repeat(80));
    console.log('Testing Jobs Database Update Functionality');
    console.log('='.repeat(80));
    
    // Step 1: Get a job to update
    console.log('\n1. Getting a job to update...');
    const jobList = await getJobLinesFromDatabase('25-1379');
    console.log(`✅ Found job: ${jobList.jobNumber} - ${jobList.jobName}`);
    console.log(`   Total line items: ${jobList.lineItems.length}`);
    
    if (jobList.lineItems.length === 0) {
      console.log('❌ No line items found to update');
      return;
    }

    // Step 2: Show current state of first item
    const firstItem = jobList.lineItems[0];
    console.log('\n2. Current state of first line item:');
    console.log(`   Part Number: ${firstItem.partNumber}`);
    console.log(`   Description: ${firstItem.description}`);
    console.log(`   Quantity Needed: ${firstItem.quantityNeeded}`);
    console.log(`   Quantity Pulled: ${firstItem.quantityPulled}`);
    console.log(`   Pulled By: ${firstItem.pulledBy || 'N/A'}`);
    console.log(`   Ordered: ${firstItem.ordered || 'N/A'}`);
    console.log(`   Type: ${firstItem.type || 'N/A'}`);

    // Step 3: Prepare update
    // Use rowIndex = 2 (first data row) which maps to index 0 in the array
    const rowIndex = 2; // This should map to the first item
    const updates: LineItemUpdate[] = [
      {
        rowIndex: rowIndex,
        quantityPulled: (firstItem.quantityPulled || 0) + 1, // Increment by 1
        pulledBy: 'Test User',
        pulledDate: new Date().toISOString().split('T')[0],
        ordered: 'Yes',
        type: 'Test Type',
      }
    ];

    console.log(`\n3. Preparing update for rowIndex ${rowIndex}...`);
    console.log(`   New Quantity Pulled: ${updates[0].quantityPulled}`);
    console.log(`   New Pulled By: ${updates[0].pulledBy}`);
    console.log(`   New Pulled Date: ${updates[0].pulledDate}`);
    console.log(`   New Ordered: ${updates[0].ordered}`);
    console.log(`   New Type: ${updates[0].type}`);

    // Step 4: Perform update
    console.log('\n4. Performing update...');
    const result = await updateJobLinesFromDatabase('25-1379', updates);
    console.log('✅ Update completed successfully!');

    // Step 5: Verify the update
    console.log('\n5. Verifying update...');
    const updatedItem = result.lineItems.find(item => item.partNumber === firstItem.partNumber);
    
    if (!updatedItem) {
      console.log('❌ Could not find updated item');
      return;
    }

    console.log('\nUpdated state:');
    console.log(`   Part Number: ${updatedItem.partNumber}`);
    console.log(`   Description: ${updatedItem.description}`);
    console.log(`   Quantity Needed: ${updatedItem.quantityNeeded}`);
    console.log(`   Quantity Pulled: ${updatedItem.quantityPulled}`);
    console.log(`   Pulled By: ${updatedItem.pulledBy || 'N/A'}`);
    console.log(`   Ordered: ${updatedItem.ordered || 'N/A'}`);
    console.log(`   Type: ${updatedItem.type || 'N/A'}`);

    // Step 6: Verify changes
    console.log('\n6. Verification:');
    const checks = [
      { name: 'Quantity Pulled', expected: updates[0].quantityPulled, actual: updatedItem.quantityPulled },
      { name: 'Pulled By', expected: updates[0].pulledBy, actual: updatedItem.pulledBy },
      { name: 'Ordered', expected: updates[0].ordered, actual: updatedItem.ordered },
      { name: 'Type', expected: updates[0].type, actual: updatedItem.type },
    ];

    let allPassed = true;
    checks.forEach(check => {
      const passed = check.expected === check.actual;
      const status = passed ? '✅' : '❌';
      console.log(`   ${status} ${check.name}: Expected "${check.expected}", Got "${check.actual}"`);
      if (!passed) allPassed = false;
    });

    if (allPassed) {
      console.log('\n' + '='.repeat(80));
      console.log('✅ All tests passed! Update functionality is working correctly.');
      console.log('='.repeat(80));
    } else {
      console.log('\n' + '='.repeat(80));
      console.log('❌ Some tests failed. Please check the output above.');
      console.log('='.repeat(80));
    }

  } catch (error) {
    console.error('❌ Error testing jobs update:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
}

testJobsUpdate();

