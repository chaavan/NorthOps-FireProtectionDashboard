import { Prisma, type Part, VendorPriceImportLineMatchStatus } from '@prisma/client';
import { catalogCostsEqual } from '@/lib/partCostLedger';
import { normalizeVendorKey } from '@/lib/vendorUtils';
import { computePercentChange } from './percentChange';
import { groupIsCollapsibleDuplicate } from './normalizeVendorRow';
import type { ParsedVendorPriceRow } from './vendorPriceImportTypes';
import { normalizeVendorPartId } from './vendorPartIdNormalize';
import { randomUUID } from 'crypto';

export type MatchedLineDraft = {
  rowIndex: number;
  vendorPartIdRaw: string;
  vendorPartIdNormalized: string;
  descriptionFromFile: string | null;
  uomFromFile: string | null;
  proposedCost: number;
  matchStatus: VendorPriceImportLineMatchStatus;
  partId: string | null;
  costBefore: Prisma.Decimal | null;
  costAfter: Prisma.Decimal | null;
  percentChange: Prisma.Decimal | null;
  conflictGroupId: string | null;
  selected: boolean;
};

type PartMatchRow = Pick<Part, 'id' | 'pn' | 'nomenclature' | 'cost' | 'vendor' | 'vendorPartID'>;

export type ClassifyDuplicateVendorIdsResult = {
  conflictGroupByRowIndex: Map<number, string>;
  collapsedRowIndexes: Set<number>;
  rowsToMatchIndexes: Set<number>;
};

export function buildVendorPartIndex(parts: PartMatchRow[]): Map<string, PartMatchRow[]> {
  const index = new Map<string, PartMatchRow[]>();
  for (const part of parts) {
    const lookupKey = normalizeVendorPartId(part.vendorPartID);
    if (!lookupKey) continue;
    const existing = index.get(lookupKey) || [];
    existing.push(part);
    index.set(lookupKey, existing);
  }
  return index;
}

/** Group by vendor ID; collapse same-price duplicates; conflict only when price differs. */
export function classifyDuplicateVendorIds(parsedRows: ParsedVendorPriceRow[]): ClassifyDuplicateVendorIdsResult {
  const byId = new Map<string, ParsedVendorPriceRow[]>();
  for (const row of parsedRows) {
    const list = byId.get(row.vendorPartIdNormalized) || [];
    list.push(row);
    byId.set(row.vendorPartIdNormalized, list);
  }

  const conflictGroupByRowIndex = new Map<number, string>();
  const collapsedRowIndexes = new Set<number>();
  const rowsToMatchIndexes = new Set<number>();

  for (const group of byId.values()) {
    if (group.length === 1) {
      rowsToMatchIndexes.add(group[0].rowIndex);
      continue;
    }

    if (groupIsCollapsibleDuplicate(group)) {
      rowsToMatchIndexes.add(group[0].rowIndex);
      for (let i = 1; i < group.length; i += 1) {
        collapsedRowIndexes.add(group[i].rowIndex);
      }
      continue;
    }

    const groupId = randomUUID();
    for (const row of group) {
      conflictGroupByRowIndex.set(row.rowIndex, groupId);
    }
  }

  return { conflictGroupByRowIndex, collapsedRowIndexes, rowsToMatchIndexes };
}

function buildBaseDraft(row: ParsedVendorPriceRow): Omit<MatchedLineDraft, 'matchStatus' | 'partId' | 'costBefore' | 'costAfter' | 'percentChange' | 'conflictGroupId' | 'selected'> {
  return {
    rowIndex: row.rowIndex,
    vendorPartIdRaw: row.vendorPartIdRaw,
    vendorPartIdNormalized: row.vendorPartIdNormalized,
    descriptionFromFile: row.descriptionFromFile,
    uomFromFile: row.uomFromFile,
    proposedCost: row.proposedCost,
  };
}

export function matchRowToInventory(
  row: ParsedVendorPriceRow,
  index: Map<string, PartMatchRow[]>,
): MatchedLineDraft {
  const base = buildBaseDraft(row);
  const matches = index.get(row.vendorPartIdNormalized) || [];

  if (matches.length === 0) {
    return {
      ...base,
      matchStatus: 'UNMATCHED',
      partId: null,
      costBefore: null,
      costAfter: null,
      percentChange: null,
      conflictGroupId: null,
      selected: false,
    };
  }

  if (matches.length > 1) {
    return {
      ...base,
      matchStatus: 'MATCHED_AMBIGUOUS',
      partId: null,
      costBefore: null,
      costAfter: null,
      percentChange: null,
      conflictGroupId: `ambiguous:${row.vendorPartIdNormalized}`,
      selected: false,
    };
  }

  const part = matches[0];
  const costBefore = part.cost;
  const costAfter = new Prisma.Decimal(row.proposedCost);

  if (catalogCostsEqual(costBefore, costAfter)) {
    return {
      ...base,
      matchStatus: 'NO_COST_CHANGE',
      partId: part.id,
      costBefore,
      costAfter,
      percentChange: null,
      conflictGroupId: null,
      selected: false,
    };
  }

  const pct = computePercentChange(Number(costBefore), row.proposedCost);

  return {
    ...base,
    matchStatus: 'MATCHED',
    partId: part.id,
    costBefore,
    costAfter,
    percentChange: pct === null ? null : new Prisma.Decimal(pct),
    conflictGroupId: null,
    selected: true,
  };
}

export function matchParsedRowsToParts(params: {
  parsedRows: ParsedVendorPriceRow[];
  parts: PartMatchRow[];
  matchVendorKey: string;
}): MatchedLineDraft[] {
  const { parsedRows, parts, matchVendorKey } = params;
  const vendorParts = parts.filter((p) => normalizeVendorKey(p.vendor) === matchVendorKey);
  const index = buildVendorPartIndex(vendorParts);
  const { conflictGroupByRowIndex, collapsedRowIndexes, rowsToMatchIndexes } =
    classifyDuplicateVendorIds(parsedRows);

  const lines: MatchedLineDraft[] = [];

  for (const row of parsedRows) {
    const conflictGroupId = conflictGroupByRowIndex.get(row.rowIndex) || null;
    if (conflictGroupId) {
      lines.push({
        ...buildBaseDraft(row),
        matchStatus: 'CONFLICT_IN_FILE',
        partId: null,
        costBefore: null,
        costAfter: null,
        percentChange: null,
        conflictGroupId,
        selected: false,
      });
      continue;
    }

    if (collapsedRowIndexes.has(row.rowIndex)) {
      lines.push({
        ...buildBaseDraft(row),
        matchStatus: 'DUPLICATE_COLLAPSED',
        partId: null,
        costBefore: null,
        costAfter: null,
        percentChange: null,
        conflictGroupId: null,
        selected: false,
      });
      continue;
    }

    if (rowsToMatchIndexes.has(row.rowIndex)) {
      lines.push(matchRowToInventory(row, index));
      continue;
    }

    throw new Error(
      `Row ${row.rowIndex} (vendor ID ${row.vendorPartIdNormalized}) was not classified during duplicate handling`,
    );
  }

  if (lines.length !== parsedRows.length) {
    throw new Error(
      `Expected ${parsedRows.length} import lines but built ${lines.length}. This indicates a matching bug.`,
    );
  }

  return lines;
}
