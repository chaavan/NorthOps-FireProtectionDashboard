import { google } from 'googleapis';
import { MovementType, type Prisma, type PrismaClient } from '@prisma/client';
import { JOB_CONTEXT_TYPE, recordOperationalDelta } from '@/lib/inventoryLedger';
import { COST_CONTEXT_JOB, setCatalogUnitCost } from '@/lib/partCostLedger';
import { parseString } from './types';
import { prisma } from './prisma';
import { partNumberLookupVariants } from './inventoryQuantity';
import { mergeManualVendorKeys } from './vendorUtils';

// Configuration
// Parts Database - same spreadsheet as Job Tracker but different sheet
const PARTS_SPREADSHEET_ID = '1U-az1-yK4p-GZAbdoK9O9ujM4belavYeBRNogxxEwUQ';
const PARTS_SHEET_GID = 217567589; // gid from the URL (PN sheet)

// Column mappings for parts database:
const PART_NUMBER_COLUMN_INDEX = 1; // Column B: "PN" - Part numbers
const SUPPLIER_COLUMN_INDEX = 11; // Column L: "Vendor" - Supplier information
const COST_COLUMN_INDEX = 4; // Column E: "Cost" - Cost per unit (was 3, but that was "Nomenclature")

let PN_SHEET_NAME: string | null = null;

/**
 * Part information from the PN database sheet
 */
export type PartInfo = {
  partNumber: string;
  description: string | null;
  supplier: string | null;
  cost: number | null; // Cost per unit
};

/**
 * Get authenticated Google Sheets client
 */
function getSheetsClient() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!serviceAccountJson) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set.');
  }

  let credentials;
  try {
    credentials = JSON.parse(serviceAccountJson);
  } catch (error) {
    throw new Error('Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON: ' + (error as Error).message);
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
}

/**
 * Get the name of the sheet containing parts data
 * Looks for common names or uses gid 217567589
 */
async function getPartsSheetName(): Promise<string> {
  if (PN_SHEET_NAME) return PN_SHEET_NAME;
  
  const sheets = getSheetsClient();
  
  try {
    // Get spreadsheet metadata to find sheet names
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId: PARTS_SPREADSHEET_ID,
    });
    
    const sheetsList = metadata.data.sheets || [];
    console.log('Available sheets in parts database:', sheetsList.map(s => ({ 
      name: s.properties?.title, 
      gid: s.properties?.sheetId 
    })));
    
    // Look for the sheet with the specified gid
    const partsSheet = sheetsList.find(s => s.properties?.sheetId === PARTS_SHEET_GID);
    
    if (partsSheet?.properties?.title) {
      PN_SHEET_NAME = partsSheet.properties.title;
      console.log(`✓ Found parts sheet: "${PN_SHEET_NAME}" (gid: ${PARTS_SHEET_GID})`);
      return PN_SHEET_NAME;
    }
    
    // Fallback: look for common names
    const commonNames = ['PN', 'Parts', 'Parts Database', 'Inventory', 'Part Numbers', 'Database'];
    for (const name of commonNames) {
      const sheet = sheetsList.find(s => 
        s.properties?.title?.toLowerCase() === name.toLowerCase()
      );
      if (sheet?.properties?.title) {
        PN_SHEET_NAME = sheet.properties.title;
        console.log(`✓ Found parts sheet by name: "${PN_SHEET_NAME}"`);
        return PN_SHEET_NAME;
      }
    }
    
    throw new Error(`Could not find parts database sheet. Please ensure a sheet with gid ${PARTS_SHEET_GID} exists.`);
  } catch (error) {
    console.error('Error finding parts sheet:', error);
    throw error;
  }
}

/**
 * Fetch all parts from the PN database and create a lookup map
 * This returns a Map<partNumber, PartInfo> for fast lookups
 */
export async function getPartsLookup(): Promise<Map<string, PartInfo>> {
  const sheets = getSheetsClient();
  const partsMap = new Map<string, PartInfo>();

  try {
    // First discover the sheet name
    const sheetName = await getPartsSheetName();
    
    // First get headers to find the right columns
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: PARTS_SPREADSHEET_ID,
      range: `'${sheetName}'!1:1`,
    });

    const headers = headerResponse.data.values?.[0] || [];
    console.log('Parts Database Headers:', headers);

    // HARDCODED column indices as per user specification:
    const partNumberCol = PART_NUMBER_COLUMN_INDEX; // Column B (index 1)
    const supplierCol = SUPPLIER_COLUMN_INDEX; // Column L (index 11)
    const costCol = COST_COLUMN_INDEX; // Column M (index 12)

    console.log(`═══════════════════════════════════════════════════`);
    console.log(`📋 Parts Database Column Mapping (Sheet: "${sheetName}", gid: ${PARTS_SHEET_GID}):`);
    console.log(`   Part Number: Column B (index ${partNumberCol}) - "${headers[partNumberCol] || 'N/A'}"`);
    console.log(`   Supplier:    Column L (index ${supplierCol}) - "${headers[supplierCol] || 'N/A'}"`);
    console.log(`   Cost/Unit:   Column E (index ${costCol}) - "${headers[costCol] || 'N/A'}"`);
    console.log(`═══════════════════════════════════════════════════`);

    // Now fetch ALL data rows (using sheetName from above)
    // No row limit - fetch all rows to ensure we get all 4000+ parts
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: PARTS_SPREADSHEET_ID,
      range: `'${sheetName}'!A2:M`, // Only need up to column M (Cost column)
    });

    const rows = response.data.values || [];
    console.log(`📦 Found ${rows.length} rows in parts database`);
    
    let matchedCount = 0;
    let skippedCount = 0;
    
    // Parse each row
    for (const row of rows) {
      const partNumber = parseString(row[partNumberCol]);
      if (!partNumber) {
        skippedCount++;
        continue;
      }

      const supplier = parseString(row[supplierCol]);
      const costStr = parseString(row[costCol]);
      const cost = costStr ? parseFloat(costStr.replace(/[^0-9.-]/g, '')) : null;
      
      const partInfo: PartInfo = {
        partNumber: partNumber,
        description: parseString(row[0]), // Column A might have description
        supplier: supplier,
        cost: !isNaN(cost as number) ? cost : null,
      };

      // Normalize part number for matching (remove ALL whitespace including tabs, uppercase)
      const normalizedPN = partNumber.replace(/[\s\t\r\n]+/g, '').toUpperCase();
      partsMap.set(normalizedPN, partInfo);
      
      // Also store with basic trim for fallback matching
      partsMap.set(partNumber.trim(), partInfo);
      
      // Store lowercase version too for case-insensitive matching
      partsMap.set(normalizedPN.toLowerCase(), partInfo);
      
      matchedCount++;
    }

    console.log(`✅ Loaded ${matchedCount} parts from database (skipped ${skippedCount} empty rows)`);
    console.log(`📊 Total unique part numbers: ${partsMap.size}`);
    
    if (partsMap.size > 0) {
      const sample = Array.from(partsMap.entries()).slice(0, 5);
      console.log('📝 Sample entries:');
      sample.forEach(([pn, info]) => {
        console.log(`   ${pn} → Supplier: ${info.supplier || 'N/A'}`);
      });
    }
    
    return partsMap;
  } catch (error) {
    console.error('Error reading PN database sheet:', error);
    throw new Error('Failed to read PN database: ' + (error as Error).message);
  }
}

/**
 * Get supplier for a specific part number
 */
export async function getSupplierForPart(partNumber: string): Promise<string | null> {
  if (!partNumber) return null;
  
  const partsLookup = await getPartsLookup();
  const normalizedPN = partNumber.trim().toUpperCase().replace(/\s+/g, '');
  const partInfo = partsLookup.get(normalizedPN);
  
  return partInfo?.supplier || null;
}

/**
 * Get suppliers for multiple part numbers (batch lookup) from database
 * Returns a Map<partNumber, supplier>
 */
export async function getSuppliersForParts(partNumbers: string[]): Promise<Map<string, string>> {
  const suppliersMap = new Map<string, string>();
  
  console.log(`Looking up suppliers for ${partNumbers.length} part numbers from database`);
  
  if (partNumbers.length === 0) {
    return suppliersMap;
  }

  // Normalize part numbers for matching
  const normalizedPartNumbers = partNumbers.map(pn => 
    pn ? pn.replace(/[\s\t\r\n]+/g, '').toUpperCase().trim() : ''
  ).filter(Boolean);

  // Query database using raw SQL since column names don't match Prisma schema
  // Build a comprehensive list of all possible variations
  const allVariations = new Set<string>();
  normalizedPartNumbers.forEach(pn => allVariations.add(pn));
  partNumbers.forEach(pn => {
    if (pn) {
      allVariations.add(pn.trim());
      allVariations.add(pn.trim().toUpperCase());
      allVariations.add(pn.trim().toLowerCase());
    }
  });

  const variationsArray = Array.from(allVariations);
  if (variationsArray.length === 0) {
    return suppliersMap;
  }

  // Use raw SQL query with actual column names (PN, Vendor)
  // Add retry logic for transient database connection issues
  const placeholders = variationsArray.map((_, i) => `$${i + 1}`).join(',');
  let parts: Array<{ pn: string; vendor: string | null }> = [];
  let lastError: Error | null = null;
  
  // Retry up to 3 times with exponential backoff
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      parts = await prisma.$queryRawUnsafe(
        `SELECT "pn", "vendor" FROM "parts" WHERE "pn" IN (${placeholders})`,
        ...variationsArray
      ) as Array<{ pn: string; vendor: string | null }>;
      break; // Success, exit retry loop
    } catch (error: any) {
      lastError = error;
      // If it's a connection error (P1001) and we have retries left, wait and retry
      if (error.code === 'P1001' && attempt < 2) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        console.warn(`Database connection failed (attempt ${attempt + 1}/3), retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error; // Re-throw if not a connection error or out of retries
    }
  }
  
  if (parts.length === 0 && lastError) {
    console.error('Failed to query database after retries:', lastError);
    // Return empty map instead of throwing - allows app to continue
    return suppliersMap;
  }

  // Create a lookup map from database results
  const dbLookup = new Map<string, string>();
  parts.forEach((part: { pn: string; vendor: string | null }) => {
    if (part.vendor) {
      const normalizedPN = part.pn.replace(/[\s\t\r\n]+/g, '').toUpperCase();
      dbLookup.set(normalizedPN, part.vendor);
      dbLookup.set(part.pn.trim(), part.vendor);
      dbLookup.set(part.pn, part.vendor);
    }
  });

  // Match input part numbers to database results
  for (const partNumber of partNumbers) {
    if (!partNumber) continue;
    
    const normalizedPN = partNumber.replace(/[\s\t\r\n]+/g, '').toUpperCase();
    const supplier = dbLookup.get(normalizedPN) || 
                     dbLookup.get(partNumber.trim()) || 
                     dbLookup.get(partNumber);
    
    if (supplier) {
      console.log(`✓ Found supplier for "${partNumber.replace(/[\t\r\n]/g, '⇥')}" (normalized: ${normalizedPN}): ${supplier}`);
      suppliersMap.set(partNumber, supplier);
    } else {
      console.log(`✗ No supplier found for "${partNumber.replace(/[\t\r\n]/g, '⇥')}" (normalized: ${normalizedPN})`);
    }
  }
  
  console.log(`Found suppliers for ${suppliersMap.size} out of ${partNumbers.length} parts`);
  return suppliersMap;
}

/**
 * Get pricing (cost and supplier) for multiple part numbers (batch lookup) from database
 * Returns a Map<partNumber, {cost, supplier}>
 */
export async function getPricingForParts(
  partNumbers: string[],
  db: PrismaClient | Prisma.TransactionClient = prisma,
): Promise<Map<string, { cost: number; supplier: string }>> {
  const pricingMap = new Map<string, { cost: number; supplier: string }>();
  
  console.log(`💰 Looking up pricing for ${partNumbers.length} part numbers from database`);
  
  if (partNumbers.length === 0) {
    return pricingMap;
  }

  // Normalize part numbers for matching
  const normalizedPartNumbers = partNumbers.map(pn => 
    pn ? pn.replace(/[\s\t\r\n]+/g, '').toUpperCase().trim() : ''
  ).filter(Boolean);

  // Query database using raw SQL since column names don't match Prisma schema
  // Build a comprehensive list of all possible variations
  const allVariations = new Set<string>();
  normalizedPartNumbers.forEach(pn => allVariations.add(pn));
  partNumbers.forEach(pn => {
    if (pn) {
      allVariations.add(pn.trim());
      allVariations.add(pn.trim().toUpperCase());
      allVariations.add(pn.trim().toLowerCase());
    }
  });

  const variationsArray = Array.from(allVariations);
  if (variationsArray.length === 0) {
    return pricingMap;
  }

  // Use raw SQL query with actual column names (PN, Cost, Vendor)
  // Add retry logic for transient database connection issues
  const placeholders = variationsArray.map((_, i) => `$${i + 1}`).join(',');
  let parts: Array<{ pn: string; cost: number; vendor: string | null }> = [];
  let lastError: Error | null = null;
  
  // Retry up to 3 times with exponential backoff
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      parts = await db.$queryRawUnsafe(
        `SELECT "pn", "cost", "vendor" FROM "parts" WHERE "pn" IN (${placeholders})`,
        ...variationsArray
      ) as Array<{ pn: string; cost: number; vendor: string | null }>;
      break; // Success, exit retry loop
    } catch (error: any) {
      lastError = error;
      // If it's a connection error (P1001) and we have retries left, wait and retry
      if (error.code === 'P1001' && attempt < 2) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        console.warn(`Database connection failed (attempt ${attempt + 1}/3), retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error; // Re-throw if not a connection error or out of retries
    }
  }
  
  if (parts.length === 0 && lastError) {
    console.error('Failed to query database after retries:', lastError);
    // Return empty map instead of throwing - allows app to continue
    return pricingMap;
  }

  // Create a lookup map from database results
  const dbLookup = new Map<string, { cost: number; supplier: string }>();
  parts.forEach((part: { pn: string; cost: number; vendor: string | null }) => {
    if (part.vendor && part.cost !== null) {
      const cost = Number(part.cost);
      if (!isNaN(cost)) {
        const normalizedPN = part.pn.replace(/[\s\t\r\n]+/g, '').toUpperCase();
        dbLookup.set(normalizedPN, { cost, supplier: part.vendor });
        dbLookup.set(part.pn.trim(), { cost, supplier: part.vendor });
        dbLookup.set(part.pn, { cost, supplier: part.vendor });
      }
    }
  });

  // Match input part numbers to database results
  for (const partNumber of partNumbers) {
    if (!partNumber) continue;
    
    const normalizedPN = partNumber.replace(/[\s\t\r\n]+/g, '').toUpperCase();
    const pricing = dbLookup.get(normalizedPN) || 
                    dbLookup.get(partNumber.trim()) || 
                    dbLookup.get(partNumber);
    
    if (pricing && pricing.cost !== null && pricing.supplier) {
      const cleanPN = partNumber.replace(/[\t\r\n]/g, '⇥');
      console.log(`✓ Found pricing for "${cleanPN}" (normalized: ${normalizedPN}): $${pricing.cost} from ${pricing.supplier}`);
      pricingMap.set(partNumber, {
        cost: pricing.cost,
        supplier: pricing.supplier,
      });
    } else {
      const cleanPN = partNumber.replace(/[\t\r\n]/g, '⇥');
      console.log(`✗ No pricing found for "${cleanPN}" (normalized: ${normalizedPN})`);
    }
  }
  
  console.log(`💵 Found complete pricing for ${pricingMap.size} out of ${partNumbers.length} parts`);
  return pricingMap;
}

/**
 * Get all unique vendors for dropdowns.
 * Prefers active master vendor records, merged with legacy part inventory vendors.
 */
export async function getAllVendors(): Promise<string[]> {
  try {
    const { getActiveVendorKeysForDropdown } = await import("@/lib/vendorService");
    return await getActiveVendorKeysForDropdown();
  } catch (error) {
    console.error("Error fetching vendors:", error);
    return mergeManualVendorKeys([]);
  }
}

/**
 * Get complete part details for a single part number
 * Returns description, unit of measurement, and vendor/supplier
 */
export async function getPartDetails(partNumber: string): Promise<{
  partNumber: string;
  description: string | null;
  unitOfMeasurement: string | null;
  type: string | null;
  found: boolean;
}> {
  if (!partNumber || !partNumber.trim()) {
    return {
      partNumber: partNumber,
      description: null,
      unitOfMeasurement: null,
      type: null,
      found: false,
    };
  }

  // Normalize part number for matching
  const normalizedPN = partNumber.replace(/[\s\t\r\n]+/g, '').toUpperCase().trim();
  
  // Build variations for matching
  const variations = [
    normalizedPN,
    partNumber.trim(),
    partNumber.trim().toUpperCase(),
    partNumber.trim().toLowerCase(),
  ];
  
  const uniqueVariations = Array.from(new Set(variations)).filter(Boolean);
  if (uniqueVariations.length === 0) {
    return {
      partNumber: partNumber,
      description: null,
      unitOfMeasurement: null,
      type: null,
      found: false,
    };
  }

  // Query database using raw SQL
  const placeholders = uniqueVariations.map((_, i) => `$${i + 1}`).join(',');
  let parts: Array<{ pn: string; nomenclature: string; units: string; vendor: string | null }> = [];
  
  try {
    parts = await prisma.$queryRawUnsafe(
      `SELECT "pn", "nomenclature", "units", "vendor" FROM "parts" WHERE "pn" IN (${placeholders}) LIMIT 1`,
      ...uniqueVariations
    ) as Array<{ pn: string; nomenclature: string; units: string; vendor: string | null }>;
  } catch (error) {
    console.error('Error fetching part details:', error);
    return {
      partNumber: partNumber,
      description: null,
      unitOfMeasurement: null,
      type: null,
      found: false,
    };
  }

  if (parts.length === 0) {
    return {
      partNumber: partNumber,
      description: null,
      unitOfMeasurement: null,
      type: null,
      found: false,
    };
  }

  const part = parts[0];
  const vendorKey = part.vendor ? part.vendor.toLowerCase().trim() : null;
  return {
    partNumber: partNumber,
    description: part.nomenclature || null,
    unitOfMeasurement: part.units || null,
    type: vendorKey || null,
    found: true,
  };
}

/**
 * Get paginated list of parts with optional search
 * Returns parts with partNumber, description, vendor, cost, and units
 */
export async function getPartsList(
  searchTerm: string = '',
  page: number = 1,
  limit: number = 50
): Promise<{
  parts: Array<{
    partNumber: string;
    description: string;
    vendor: string | null;
    cost: number;
    units: string;
  }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  try {
    // Validate pagination parameters
    const validPage = Math.max(1, page);
    const validLimit = Math.max(1, Math.min(100, limit)); // Max 100 items per page
    const offset = (validPage - 1) * validLimit;

    // Build WHERE clause - always filter out empty/null part numbers
    let whereClause = `WHERE "pn" IS NOT NULL AND "pn" != ''`;
    let queryParams: any[] = [];
    
    if (searchTerm.trim()) {
      const searchPattern = `%${searchTerm.trim()}%`;
      whereClause += ` AND ("pn" ILIKE $1 OR "nomenclature" ILIKE $1 OR "vendor" ILIKE $1)`;
      queryParams.push(searchPattern);
    }

    // Get total count
    const countQuery = `SELECT COUNT(*) as count FROM "parts" ${whereClause}`;
    
    const countResult = await prisma.$queryRawUnsafe(
      countQuery,
      ...queryParams
    ) as Array<{ count: bigint }>;
    
    const total = Number(countResult[0].count);

    // Get paginated results
    const partsQuery = `
      SELECT 
        "pn" as "partNumber",
        "nomenclature" as "description",
        "vendor",
        "cost",
        "units"
      FROM "parts"
      ${whereClause}
      ORDER BY "pn" ASC
      LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
    `;
    
    const parts = await prisma.$queryRawUnsafe(
      partsQuery,
      ...queryParams,
      validLimit,
      offset
    ) as Array<{
      partNumber: string;
      description: string;
      vendor: string | null;
      cost: number;
      units: string;
    }>;

    const totalPages = Math.ceil(total / validLimit);

    return {
      parts,
      total,
      page: validPage,
      limit: validLimit,
      totalPages,
    };
  } catch (error) {
    console.error('Error fetching parts list:', error);
    throw new Error('Failed to fetch parts list: ' + (error as Error).message);
  }
}

/**
 * Set catalog `Part.cost` to 0 when a job line supplier differs from the parts DB vendor (audit via part_cost_changes).
 */
export async function updatePartPriceToZero(
  partNumber: string,
  opts: { jobNumber: string },
): Promise<void> {
  if (!partNumber || !opts?.jobNumber?.trim()) return;

  try {
    const lookupVariants = partNumberLookupVariants(partNumber);
    await prisma.$transaction(async (tx) => {
      const part = await findPartRowByLookupVariants(lookupVariants, tx);
      if (!part) {
        console.warn(`[updatePartPriceToZero] Part not found for PN ${partNumber}`);
        return;
      }
      await setCatalogUnitCost(tx, {
        partId: part.id,
        newUnitCost: 0,
        actorUserId: null,
        contextType: COST_CONTEXT_JOB,
        contextId: opts.jobNumber.trim(),
        note: `Catalog cost cleared to 0 (job supplier differs from parts catalog). Job ${opts.jobNumber.trim()}.`,
      });
    });

    console.log(`✓ Catalog cost set to 0 for part ${partNumber} (job ${opts.jobNumber.trim()})`);
  } catch (error) {
    console.error(`Error updating price for part ${partNumber}:`, error);
    // Don't throw - this is a non-critical update
  }
}

/**
 * Resolve a single Part row for inventory by PN variants. If multiple DB rows match
 * the same variants (duplicate pn), logs a warning and returns the stable choice (id asc).
 */
export async function findPartRowByLookupVariants(
  lookupVariants: string[],
  tx?: Prisma.TransactionClient,
) {
  const client = tx ?? prisma;
  const rows = await client.part.findMany({
    where: {
      OR: lookupVariants.map((pn) => ({ pn })),
    },
    orderBy: { id: 'asc' },
  });
  if (rows.length > 1) {
    console.warn(
      `[inventory] Duplicate Part rows for PN lookup variants [${lookupVariants.join(', ')}]: count=${rows.length} ids=[${rows.map((r) => r.id).join(', ')}]. Using id=${rows[0].id}.`,
    );
  }
  return rows[0] ?? null;
}

/** Prisma interactive transaction limits for inventory pull/unpull work. */
export const INVENTORY_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 15_000,
} as const;

export type JobInventoryAdjustment = {
  partNumber: string;
  /** Signed on-hand change (negative when pulling from stock). */
  deltaQuantity: number;
};

async function applyPartQuantityChangeForJob(
  tx: Prisma.TransactionClient,
  partNumber: string,
  deltaQuantity: number,
  jobNumber: string,
  actorUserId: string | null,
): Promise<void> {
  const lookupVariants = partNumberLookupVariants(partNumber);
  const part = await findPartRowByLookupVariants(lookupVariants, tx);

  if (!part) {
    console.warn(`[adjustPartQuantityForJob] Part not found for PN ${partNumber}`);
    return;
  }

  const movementType =
    deltaQuantity < 0 ? MovementType.PULL : MovementType.UNPULL;
  await recordOperationalDelta(tx, {
    partId: part.id,
    signedDelta: deltaQuantity,
    movementType,
    contextType: JOB_CONTEXT_TYPE,
    contextId: jobNumber,
    actorUserId: actorUserId?.trim() || null,
    note: 'Auto-sync from job pull/update',
  });

  // Update part allocation for this job and clamp at zero.
  const allocationDelta = -deltaQuantity;
  const existingAllocation = await tx.partAllocation.findUnique({
    where: {
      partId_jobId: {
        partId: part.id,
        jobId: jobNumber,
      },
    },
    select: { id: true, quantityPulled: true },
  });

  const nextAllocation = Math.max(
    0,
    (existingAllocation?.quantityPulled ?? 0) + allocationDelta,
  );

  if (existingAllocation) {
    await tx.partAllocation.update({
      where: { id: existingAllocation.id },
      data: { quantityPulled: nextAllocation },
    });
  } else {
    await tx.partAllocation.create({
      data: {
        partId: part.id,
        jobId: jobNumber,
        quantityPulled: Math.max(0, allocationDelta),
      },
    });
  }
}

/**
 * Apply multiple job-linked inventory changes in one transaction (batch job saves).
 */
export async function adjustPartQuantitiesForJobBatch(
  adjustments: JobInventoryAdjustment[],
  jobNumber: string,
  actorUserId: string | null = null,
): Promise<void> {
  const pending = adjustments.filter(
    (adjustment) => adjustment.partNumber && adjustment.deltaQuantity !== 0,
  );
  if (pending.length === 0) return;

  await prisma.$transaction(async (tx) => {
    for (const { partNumber, deltaQuantity } of pending) {
      await applyPartQuantityChangeForJob(
        tx,
        partNumber,
        deltaQuantity,
        jobNumber,
        actorUserId,
      );
    }
  }, INVENTORY_TRANSACTION_OPTIONS);
}

/**
 * Adjust on-hand quantity for a part and log an inventory movement (context: JOB)
 * deltaQuantity: signed integer change to on-hand (negative to decrement when pulling)
 */
export async function adjustPartQuantityForJob(
  partNumber: string,
  deltaQuantity: number,
  jobNumber: string,
  actorUserId: string | null = null,
  txClient?: Prisma.TransactionClient,
): Promise<void> {
  if (!partNumber || deltaQuantity === 0) return;

  if (txClient) {
    await applyPartQuantityChangeForJob(
      txClient,
      partNumber,
      deltaQuantity,
      jobNumber,
      actorUserId,
    );
    return;
  }

  await prisma.$transaction(
    async (tx) => {
      await applyPartQuantityChangeForJob(
        tx,
        partNumber,
        deltaQuantity,
        jobNumber,
        actorUserId,
      );
    },
    INVENTORY_TRANSACTION_OPTIONS,
  );
}

