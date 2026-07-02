/**
 * Smartsheet API Integration
 * Handles updates to Smartsheet when all items are received
 */

import type { JobLineItem } from './types';

// Environment variables
const SMARTSHEET_TOKEN = process.env.SMARTSHEET_TOKEN || '';
const BASE_URL_SMARTSHEET = process.env.BASE_URL_SMARTSHEET || 'https://api.smartsheet.com/2.0';

// Column IDs
const JOB_NUMBER_COLUMN_ID = '5184934759059332';
const BOOLEAN_COLUMN_ID = '973255552487300';

/**
 * Check if all ordered items have been received
 */
export function areAllOrderedItemsReceived(lineItems: JobLineItem[]): boolean {
  // Get all items that are marked as ordered
  const orderedItems = lineItems.filter(
    item => item.ordered?.toLowerCase() === 'yes'
  );

  // If no ordered items, return false (nothing to check)
  if (orderedItems.length === 0) {
    return false;
  }

  // Check if ALL ordered items are marked as received
  const allReceived = orderedItems.every(
    item => item.receivedFromOrder?.toLowerCase() === 'yes'
  );

  return allReceived;
}

/**
 * Update Smartsheet rows for a job number
 * Sets the boolean column to false for all matching rows
 */
export async function updateSmartsheetJobStatus(
  sheetId: string,
  jobNumber: string
): Promise<{ success: boolean; updatedRows: number; error?: string }> {
  if (!SMARTSHEET_TOKEN) {
    console.warn('⚠️ SMARTSHEET_TOKEN not configured - skipping Smartsheet update');
    return { success: false, updatedRows: 0, error: 'SMARTSHEET_TOKEN not configured' };
  }

  try {
    console.log(`🔍 Searching Smartsheet for job number: ${jobNumber}`);

    // Step 1: Get all rows from the sheet
    const getRowsResponse = await fetch(
      `${BASE_URL_SMARTSHEET}/sheets/${sheetId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${SMARTSHEET_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!getRowsResponse.ok) {
      const errorText = await getRowsResponse.text();
      throw new Error(`Failed to get sheet data: ${getRowsResponse.status} - ${errorText}`);
    }

    const sheetData = await getRowsResponse.json();

    // Step 2: Find rows with matching job number
    const matchingRows = sheetData.rows?.filter((row: any) => {
      const jobNumberCell = row.cells?.find(
        (cell: any) => cell.columnId.toString() === JOB_NUMBER_COLUMN_ID
      );
      return jobNumberCell?.value?.toString() === jobNumber;
    }) || [];

    if (matchingRows.length === 0) {
      console.log(`ℹ️ No matching rows found for job number: ${jobNumber}`);
      return { success: true, updatedRows: 0 };
    }

    console.log(`📝 Found ${matchingRows.length} matching rows for job ${jobNumber}`);

    // Step 3: Prepare update payload
    const updatePayload = {
      rows: matchingRows.map((row: any) => ({
        id: row.id,
        cells: [
          {
            columnId: BOOLEAN_COLUMN_ID,
            value: false,
          },
        ],
      })),
    };

    // Step 4: Update the rows
    const updateResponse = await fetch(
      `${BASE_URL_SMARTSHEET}/sheets/${sheetId}/rows`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${SMARTSHEET_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatePayload),
      }
    );

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      throw new Error(`Failed to update rows: ${updateResponse.status} - ${errorText}`);
    }

    const updateResult = await updateResponse.json();

    console.log(`✅ Successfully updated ${matchingRows.length} rows in Smartsheet for job ${jobNumber}`);

    return {
      success: true,
      updatedRows: matchingRows.length,
    };

  } catch (error) {
    console.error('❌ Error updating Smartsheet:', error);
    return {
      success: false,
      updatedRows: 0,
      error: (error as Error).message,
    };
  }
}

/**
 * Check if all ordered items are received and update Smartsheet if needed
 * This is a convenience function that combines the check and update
 */
export async function checkAndUpdateSmartsheetIfComplete(
  sheetId: string,
  jobNumber: string,
  lineItems: JobLineItem[]
): Promise<{ allReceived: boolean; smartsheetUpdated: boolean; updatedRows?: number }> {
  // Check if all ordered items are received
  const allReceived = areAllOrderedItemsReceived(lineItems);

  if (!allReceived) {
    console.log(`ℹ️ Job ${jobNumber}: Not all ordered items are received yet`);
    return { allReceived: false, smartsheetUpdated: false };
  }

  console.log(`🎉 Job ${jobNumber}: All ordered items have been received!`);

  // Update Smartsheet
  const result = await updateSmartsheetJobStatus(sheetId, jobNumber);

  return {
    allReceived: true,
    smartsheetUpdated: result.success,
    updatedRows: result.updatedRows,
  };
}

