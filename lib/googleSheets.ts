import { google } from 'googleapis';
import type {
  JobLineItem,
  JobInfo,
  LineItemUpdate,
  JobDetailsResponse,
  JobListResponse
} from './types';
import {
  SHEET_COLUMNS,
  parseNumber,
  parseString,
  columnIndexToLetter
} from './types';

// Configuration
const SPREADSHEET_ID = '1U-az1-yK4p-GZAbdoK9O9ujM4belavYeBRNogxxEwUQ';
const SHEET_NAME = 'Job Tracker';
const DATA_RANGE = `${SHEET_NAME}!A2:R`; // Start from row 2 (skip header) - includes Type column

/**
 * Get authenticated Google Sheets client using Service Account
 */
function getSheetsClient() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!serviceAccountJson) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set. ' +
      'Please follow the setup instructions in SETUP_INSTRUCTIONS.md'
    );
  }

  let credentials;
  try {
    credentials = JSON.parse(serviceAccountJson);
  } catch (error) {
    throw new Error(
      'Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON. ' +
      'Make sure it contains valid JSON. Error: ' + (error as Error).message
    );
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
}

/**
 * Parse a row from the sheet into a JobLineItem object
 */
function parseRowToLineItem(row: any[], rowIndex: number): JobLineItem {
  return {
    rowIndex: rowIndex + 2, // +2 because: rows are 0-indexed, and we skip header row
    jobNumber: parseString(row[SHEET_COLUMNS.JOB_NUMBER]) || '',
    jobName: parseString(row[SHEET_COLUMNS.JOB_NAME]) || '',
    contractNumber: parseString(row[SHEET_COLUMNS.CONTRACT_NUMBER]),
    listNumber: parseString(row[SHEET_COLUMNS.LIST_NUMBER]),
    area: parseString(row[SHEET_COLUMNS.AREA]),
    location: parseString(row[SHEET_COLUMNS.LOCATION]),
    stocklistDate: parseString(row[SHEET_COLUMNS.STOCKLIST_DATE]),
    uom: parseString(row[SHEET_COLUMNS.UNIT_OF_MEASUREMENT]),
    quantityPulled: parseNumber(row[SHEET_COLUMNS.PULLED]) || 0,
    quantityNeeded: parseNumber(row[SHEET_COLUMNS.QUANTITY_NEEDED]) || 0,
    quantityFab: 0, // Legacy Sheets backend has no FAB column
    quantityOrdered: null, // Not stored in sheet, managed by application
    quantityPulledFromPreorder: 0,
    quantityPreordered: 0, // Legacy alias; not stored in sheet
    quantityReceivedFromOrder: null, // Not stored in sheet, managed by application
    partNumber: parseString(row[SHEET_COLUMNS.PART_NUMBER]),
    description: parseString(row[SHEET_COLUMNS.DESCRIPTION]),
    pulledBy: parseString(row[SHEET_COLUMNS.PULLED_BY]),
    pulledDate: parseString(row[SHEET_COLUMNS.PULLED_DATE]),
    ordered: parseString(row[SHEET_COLUMNS.ORDERED]),
    receivedFromOrder: parseString(row[SHEET_COLUMNS.RECEIVED_FROM_ORDER]),
    delivered: parseString(row[SHEET_COLUMNS.DELIVERED]),
    type: parseString(row[SHEET_COLUMNS.TYPE]),
  };
}

/**
 * Read all rows from the Job Tracker sheet
 */
async function getAllRows(): Promise<JobLineItem[]> {
  const sheets = getSheetsClient();

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: DATA_RANGE,
    });

    const rows = response.data.values || [];

    return rows
      .map((row, index) => parseRowToLineItem(row, index))
      .filter(item => item.jobNumber); // Filter out rows without job numbers
  } catch (error) {
    console.error('Error reading from Google Sheets:', error);
    throw new Error('Failed to read from Google Sheets: ' + (error as Error).message);
  }
}

/**
 * Get a list of all unique jobs with summary information
 */
export async function getJobList(): Promise<JobListResponse> {
  const allRows = await getAllRows();

  // Group by job number
  const jobMap = new Map<string, { name: string; items: JobLineItem[] }>();

  for (const item of allRows) {
    if (!jobMap.has(item.jobNumber)) {
      jobMap.set(item.jobNumber, {
        name: item.jobName,
        items: [],
      });
    }
    jobMap.get(item.jobNumber)!.items.push(item);
  }

  // Convert to JobInfo array
  const jobs: JobInfo[] = Array.from(jobMap.entries()).map(([jobNumber, data]) => {
    const pulledCount = data.items.filter(item => {
      const needed = item.quantityNeeded || 0;
      const pulled = item.quantityPulled || 0;
      const receivedFromVendor = item.quantityReceivedFromOrder || 0;
      return (pulled + receivedFromVendor) >= needed && needed > 0;
    }).length;

    return {
      jobNumber,
      jobName: data.name,
      lineCount: data.items.length,
      pulledCount,
    };
  });

  // Sort by job number (descending, so newest jobs appear first)
  jobs.sort((a, b) => b.jobNumber.localeCompare(a.jobNumber));

  return { jobs };
}

/**
 * Get all line items for a specific job
 */
export async function getJobLines(jobNumber: string): Promise<JobDetailsResponse> {
  const allRows = await getAllRows();

  // Filter by job number (case-insensitive, trimmed)
  const lineItems = allRows.filter(
    item => item.jobNumber.trim().toLowerCase() === jobNumber.trim().toLowerCase()
  );

  if (lineItems.length === 0) {
    throw new Error(`No line items found for job number: ${jobNumber}`);
  }

  return {
    jobNumber: lineItems[0].jobNumber,
    jobName: lineItems[0].jobName,
    lineItems,
  };
}

/**
 * Update multiple line items in batch
 */
export async function updateJobLines(
  jobNumber: string,
  updates: LineItemUpdate[]
): Promise<JobDetailsResponse> {
  if (updates.length === 0) {
    throw new Error('No updates provided');
  }

  const sheets = getSheetsClient();

  try {
    // Prepare batch update data
    // We need to update separate columns based on what's provided
    const data: any[] = [];

    updates.forEach(update => {
      const pulledCol = columnIndexToLetter(SHEET_COLUMNS.PULLED);
      const pulledByCol = columnIndexToLetter(SHEET_COLUMNS.PULLED_BY);
      const pulledDateCol = columnIndexToLetter(SHEET_COLUMNS.PULLED_DATE);
      const orderedCol = columnIndexToLetter(SHEET_COLUMNS.ORDERED);
      const typeCol = columnIndexToLetter(SHEET_COLUMNS.TYPE);
      const partNumberCol = columnIndexToLetter(SHEET_COLUMNS.PART_NUMBER);
      const descriptionCol = columnIndexToLetter(SHEET_COLUMNS.DESCRIPTION);
      const uomCol = columnIndexToLetter(SHEET_COLUMNS.UNIT_OF_MEASUREMENT);
      const quantityNeededCol = columnIndexToLetter(SHEET_COLUMNS.QUANTITY_NEEDED);

      // Update column I (Pulled) - only if provided
      if (update.quantityPulled !== undefined) {
        data.push({
          range: `${SHEET_NAME}!${pulledCol}${update.rowIndex}`,
          values: [[update.quantityPulled]],
        });
      }

      // Update column K (Pulled By) - only if provided
      if (update.pulledBy !== undefined) {
        data.push({
          range: `${SHEET_NAME}!${pulledByCol}${update.rowIndex}`,
          values: [[update.pulledBy || '']],
        });
      }

      // Update column L (Pulled Date) - only if provided
      if (update.pulledDate !== undefined) {
        data.push({
          range: `${SHEET_NAME}!${pulledDateCol}${update.rowIndex}`,
          values: [[update.pulledDate || '']],
        });
      }

      // Update column N (Ordered?) - only if provided
      if (update.ordered !== undefined) {
        data.push({
          range: `${SHEET_NAME}!${orderedCol}${update.rowIndex}`,
          values: [[update.ordered || '']],
        });
      }

      // Update column O (Received from Order?) - only if provided
      if (update.receivedFromOrder !== undefined) {
        const receivedCol = columnIndexToLetter(SHEET_COLUMNS.RECEIVED_FROM_ORDER);
        data.push({
          range: `${SHEET_NAME}!${receivedCol}${update.rowIndex}`,
          values: [[update.receivedFromOrder || '']],
        });
      }

      // Update column R (Type) - only if provided
      if (update.type !== undefined) {
        data.push({
          range: `${SHEET_NAME}!${typeCol}${update.rowIndex}`,
          values: [[update.type || '']],
        });
      }

      // NEW: Update column Q (Part Number) - only if provided
      if (update.partNumber !== undefined) {
        data.push({
          range: `${SHEET_NAME}!${partNumberCol}${update.rowIndex}`,
          values: [[update.partNumber || '']],
        });
      }

      // NEW: Update column M (Description) - only if provided
      if (update.description !== undefined) {
        data.push({
          range: `${SHEET_NAME}!${descriptionCol}${update.rowIndex}`,
          values: [[update.description || '']],
        });
      }

      // NEW: Update column H (UOM) - only if provided
      if (update.uom !== undefined) {
        data.push({
          range: `${SHEET_NAME}!${uomCol}${update.rowIndex}`,
          values: [[update.uom || '']],
        });
      }

      // NEW: Update column J (Quantity Needed) - only if provided
      if (update.quantityNeeded !== undefined) {
        data.push({
          range: `${SHEET_NAME}!${quantityNeededCol}${update.rowIndex}`,
          values: [[update.quantityNeeded]],
        });
      }
    });

    // Execute batch update
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data,
      },
    });

    // Fetch and return updated data
    return await getJobLines(jobNumber);
  } catch (error) {
    console.error('Error updating Google Sheets:', error);
    throw new Error('Failed to update Google Sheets: ' + (error as Error).message);
  }
}

/**
 * Add a new line item to a job
 */
export async function addJobLine(
  jobNumber: string,
  jobName: string,
  newItem: Partial<JobLineItem>
): Promise<JobDetailsResponse> {
  const sheets = getSheetsClient();

  try {
    // Find the next empty row
    const allRows = await getAllRows();
    const nextRow = allRows.length + 2; // +2 for header and 0-index

    // Prepare the new row data
    const rowData = [
      jobNumber,                           // A: Job Number
      jobName,                             // B: Job Name
      newItem.contractNumber || '',        // C: Contract Number
      newItem.listNumber || '',            // D: List Number
      newItem.area || '',                  // E: Area
      newItem.location || '',              // F: Location
      newItem.stocklistDate || '',         // G: Stocklist Date
      newItem.uom || '',                   // H: UOM
      newItem.quantityPulled || 0,         // I: Pulled
      newItem.quantityNeeded || 0,         // J: Quantity Needed
      newItem.pulledBy || '',              // K: Pulled By
      newItem.pulledDate || '',            // L: Pulled Date
      newItem.description || '',           // M: Description
      newItem.ordered || '',               // N: Ordered
      newItem.receivedFromOrder || '',     // O: Received From Order
      newItem.delivered || '',             // P: Delivered
      newItem.partNumber || '',            // Q: Part Number
      newItem.type || '',                  // R: Type
    ];

    // Append the row
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A${nextRow}:R${nextRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [rowData],
      },
    });

    console.log(`✅ Added new line item at row ${nextRow}`);

    // Return updated job data
    return await getJobLines(jobNumber);
  } catch (error) {
    console.error('Error adding line item:', error);
    throw new Error('Failed to add line item: ' + (error as Error).message);
  }
}

/**
 * Health check - verify we can connect to Google Sheets
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const sheets = getSheetsClient();
    const response = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });
    return !!response.data;
  } catch (error) {
    console.error('Google Sheets health check failed:', error);
    return false;
  }
}
