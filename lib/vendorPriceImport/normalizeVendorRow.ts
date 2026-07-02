import { catalogCostsEqual } from '@/lib/partCostLedger';
import type { ParsedVendorPriceRow } from './vendorPriceImportTypes';

export function normalizeDescriptionForCompare(description: string | null | undefined): string {
  return (description || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

/** Same normalized description and catalog price. */
export function rowsAreEquivalentForVendorId(a: ParsedVendorPriceRow, b: ParsedVendorPriceRow): boolean {
  if (normalizeDescriptionForCompare(a.descriptionFromFile) !== normalizeDescriptionForCompare(b.descriptionFromFile)) {
    return false;
  }
  return catalogCostsEqual(a.proposedCost, b.proposedCost);
}

export function rowsShareSameVendorPrice(a: ParsedVendorPriceRow, b: ParsedVendorPriceRow): boolean {
  return catalogCostsEqual(a.proposedCost, b.proposedCost);
}

/** Duplicate vendor IDs with the same price — collapse and auto-match (description may differ). */
export function groupIsCollapsibleDuplicate(group: ParsedVendorPriceRow[]): boolean {
  if (group.length <= 1) return true;
  const first = group[0];
  return group.every((row) => rowsShareSameVendorPrice(first, row));
}

/** @deprecated Use groupIsCollapsibleDuplicate — kept as alias for existing imports/tests. */
export function groupIsFullyEquivalent(group: ParsedVendorPriceRow[]): boolean {
  return groupIsCollapsibleDuplicate(group);
}
