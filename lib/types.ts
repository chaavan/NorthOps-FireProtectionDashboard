/**
 * Type definitions for Job Pulling Dashboard
 */

/**
 * Represents a single line item from the Job Tracker sheet
 */
export type JobLineItem = {
  rowIndex: number;           // 2-based row index in the Google Sheet (row 1 is header)
  jobNumber: string;
  jobName: string;
  contractNumber: string | null;
  listNumber: string | null;
  area: string | null;
  location: string | null;
  stocklistDate: string | null;
  uom: string | null;
  quantityNeeded: number | null;
  quantityFab: number | null;
  quantityOrdered: number | null;
  quantityPulled: number | null;
  /** Qty pulled from the job's received pre-order pool on this list line. */
  quantityPulledFromPreorder: number | null;
  /** @deprecated Legacy display field; use quantityPulledFromPreorder. */
  quantityPreordered: number | null;
  quantityReceivedFromOrder: number | null;
  lineOrder?: number | null;
  pickupFromSupplier?: boolean | null;
  supplierDeliveryToJobsite?: boolean | null;
  partNumber: string | null;
  description: string | null;
  pulledBy: string | null;
  pulledDate: string | null;
  ordered: string | null;
  receivedFromOrder: string | null;
  delivered: string | null;
  type: string | null;        // Location/Type (Fab'd, Loose, Shop, Etna, etc.)
  supplierFromDatabase?: string | null;  // Actual supplier from PN database lookup
  manualCost?: number | null; // Manual cost override persisted on the job line
  listedBy?: string | null;   // Email of the user who listed the job
  listedByName?: string | null; // Resolved display name for listedBy email
};

/**
 * Represents a job with its basic info (for the job list/selector)
 */
export type JobInfo = {
  jobNumber: string;
  jobName: string;
  lineCount: number;          // Total number of line items for this job
  pulledCount: number;        // Number of fully pulled line items
  listNumbers?: string[];     // Distinct list numbers for this job (e.g. ["1", "2"])
};

export type JobMetadata = {
  listNumber: string | null;
  area: string | null;
  locationShipTo: string | null;
  stocklistDeliveryShipDate: string | null;
  listedBy: string | null;
  listedByName?: string | null;
  /** True when this list's purchase order has been accounted for (printed or marked manually). */
  purchaseOrderAccountedFor?: boolean;
};

/**
 * Update payload for a single line item
 */
export type LineItemUpdate = {
  rowIndex: number;
  quantityPulled?: number;
  quantityPulledFromPreorder?: number;
  quantityFab?: number;
  quantityReceivedFromOrder?: number;
  pulledBy?: string;
  pulledDate?: string;
  ordered?: string; // "Yes" or empty
  receivedFromOrder?: string; // "Yes" or empty
  type?: string; // Location/Type dropdown
  // New editable fields
  partNumber?: string;
  description?: string;
  uom?: string;
  quantityNeeded?: number;
  quantityOrdered?: number | null;
  manualCost?: number | null; // Manual cost override
  supplier?: string; // Selected supplier from dropdown
  lineOrder?: number | null;
};

/**
 * Request body for batch update API
 */
export type BatchUpdateRequest = {
  jobNumber: string;
  updates: LineItemUpdate[];
};

/**
 * Response from the job list API
 */
export type JobListResponse = {
  jobs: JobInfo[];
};

/**
 * Response from the get job API
 */
export type JobDetailsResponse = {
  jobNumber: string;
  jobName: string;
  lineItems: JobLineItem[];
  jobMeta?: JobMetadata;
  pageVersion?: string;
};

/**
 * Response from the update job API
 */
export type UpdateJobResponse = {
  success: boolean;
  updatedCount: number;
  lineItems: JobLineItem[];
  pageVersion?: string;
};

/**
 * Column mapping for the Job Tracker sheet
 * Based on the specification: columns A through Q
 */
export const SHEET_COLUMNS = {
  JOB_NUMBER: 0,              // A
  JOB_NAME: 1,                // B
  CONTRACT_NUMBER: 2,         // C
  LIST_NUMBER: 3,             // D
  AREA: 4,                    // E
  LOCATION: 5,                // F
  STOCKLIST_DATE: 6,          // G
  UNIT_OF_MEASUREMENT: 7,     // H
  PULLED: 8,                  // I
  QUANTITY_NEEDED: 9,         // J
  PULLED_BY: 10,              // K
  PULLED_DATE: 11,            // L
  DESCRIPTION: 12,            // M
  ORDERED: 13,                // N
  RECEIVED_FROM_ORDER: 14,    // O
  DELIVERED: 15,              // P
  PART_NUMBER: 16,            // Q
  TYPE: 17,                   // R - Type/Location dropdown
} as const;

/**
 * Helper to convert column index to letter (0 -> A, 1 -> B, etc.)
 */
export function columnIndexToLetter(index: number): string {
  let letter = '';
  let num = index;
  
  while (num >= 0) {
    letter = String.fromCharCode((num % 26) + 65) + letter;
    num = Math.floor(num / 26) - 1;
  }
  
  return letter;
}

/**
 * Helper to parse a number from a cell value (handles strings, nulls, etc.)
 */
export function parseNumber(value: any): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const num = typeof value === 'string' ? parseFloat(value) : Number(value);
  return isNaN(num) ? null : num;
}

/**
 * Helper to parse a string from a cell value
 */
export function parseString(value: any): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value).trim();
}
