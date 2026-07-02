import type { ParsedVendorPriceRow } from '../vendorPriceImportTypes';
import { isValidVendorPartIdForMatch, normalizeVendorPartId } from '../vendorPartIdNormalize';
import { cellToNumber, cellToString, readSpreadsheetRows } from './parseSpreadsheet';

const COL_UOM = 0;
const COL_DESCRIPTION = 1;
const COL_VENDOR_PART_ID = 2;
const COL_PRICE = 3;

function rowLooksLikeData(row: unknown[]): boolean {
  const vendorId = cellToNumber(row[COL_VENDOR_PART_ID]);
  const price = cellToNumber(row[COL_PRICE]);
  return vendorId !== null && price !== null && price >= 0;
}

export function parseEtnaBook1V1(fileBytes: Buffer, fileName: string): ParsedVendorPriceRow[] {
  const rows = readSpreadsheetRows(fileBytes, fileName);
  const parsed: ParsedVendorPriceRow[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!Array.isArray(row) || !rowLooksLikeData(row)) continue;

    const vendorPartIdRaw = cellToString(row[COL_VENDOR_PART_ID]);
    const vendorPartIdNormalized = normalizeVendorPartId(
      row[COL_VENDOR_PART_ID] as string | number | null | undefined,
    );
    if (!isValidVendorPartIdForMatch(vendorPartIdNormalized)) continue;

    const proposedCost = cellToNumber(row[COL_PRICE]);
    if (proposedCost === null || proposedCost < 0) continue;

    parsed.push({
      rowIndex: i,
      vendorPartIdRaw,
      vendorPartIdNormalized,
      descriptionFromFile: cellToString(row[COL_DESCRIPTION]) || null,
      uomFromFile: cellToString(row[COL_UOM]) || null,
      proposedCost: Math.round(proposedCost * 100) / 100,
    });
  }

  if (parsed.length === 0) {
    throw new Error('No pricing rows found. Expected ETNA format with vendor ID in column C and price in column D.');
  }

  return parsed;
}
