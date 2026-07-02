import assert from 'assert';
import {
  countUnresolvedActionableGroups,
  isActionableFileConflictGroup,
  isActionableReviewConflictGroup,
} from '../lib/vendorPriceImport/conflictGroups';
import { classifyDuplicateVendorIds } from '../lib/vendorPriceImport/matchVendorPrices';
import {
  groupIsCollapsibleDuplicate,
  groupIsFullyEquivalent,
  normalizeDescriptionForCompare,
  rowsAreEquivalentForVendorId,
  rowsShareSameVendorPrice,
} from '../lib/vendorPriceImport/normalizeVendorRow';
import type { ParsedVendorPriceRow } from '../lib/vendorPriceImport/vendorPriceImportTypes';

function row(
  rowIndex: number,
  id: string,
  description: string,
  cost: number,
): ParsedVendorPriceRow {
  return {
    rowIndex,
    vendorPartIdRaw: id,
    vendorPartIdNormalized: id,
    descriptionFromFile: description,
    uomFromFile: 'EA',
    proposedCost: cost,
  };
}

assert.equal(
  normalizeDescriptionForCompare('VIC 717 8 FIRELOCK CHECK VALVE'),
  normalizeDescriptionForCompare('vic 717  8   firelock check valve'),
);

const a = row(1, '16683', 'VIC 717 8 FIRELOCK CHECK VALVE', 947.21);
const b = row(2, '16683', 'VIC 717 8 FIRELOCK CHECK VALVE', 947.21);
const c = row(3, '16683', 'VIC 717 8 FIRELOCK CHECK VALVE', 947.21);
assert.ok(rowsAreEquivalentForVendorId(a, b));
assert.ok(groupIsFullyEquivalent([a, b, c]));

const d = row(4, '48341', 'PIPE', 1.08);
const e = row(5, '48341', 'PIPE', 1.15);
assert.ok(!rowsAreEquivalentForVendorId(d, e));
assert.ok(!groupIsFullyEquivalent([d, e]));

const f = row(6, '99', 'PART A', 10);
const g = row(7, '99', 'PART B', 10);
assert.ok(!rowsAreEquivalentForVendorId(f, g));
assert.ok(rowsShareSameVendorPrice(f, g));
assert.ok(groupIsCollapsibleDuplicate([f, g]));
assert.ok(groupIsFullyEquivalent([f, g]));

const samePriceDupes = classifyDuplicateVendorIds([f, g]);
assert.equal(samePriceDupes.conflictGroupByRowIndex.size, 0);
assert.equal(samePriceDupes.collapsedRowIndexes.size, 1);
assert.ok(samePriceDupes.rowsToMatchIndexes.has(f.rowIndex));

assert.ok(
  !isActionableFileConflictGroup([
    { matchStatus: 'CONFLICT_IN_FILE', conflictGroupId: 'g1', selected: false },
  ]),
);
assert.ok(
  isActionableFileConflictGroup([
    { matchStatus: 'CONFLICT_IN_FILE', conflictGroupId: 'g1', selected: false },
    { matchStatus: 'CONFLICT_IN_FILE', conflictGroupId: 'g1', selected: false },
  ]),
);
assert.equal(
  countUnresolvedActionableGroups([
    { matchStatus: 'CONFLICT_IN_FILE', conflictGroupId: 'orphan', selected: false },
    {
      matchStatus: 'CONFLICT_IN_FILE',
      conflictGroupId: 'real',
      selected: false,
    },
    {
      matchStatus: 'CONFLICT_IN_FILE',
      conflictGroupId: 'real',
      selected: false,
    },
  ]),
  1,
);
assert.ok(
  !isActionableReviewConflictGroup({
    conflictGroupId: 'x',
    vendorPartIdNormalized: '1',
    rows: [
      {
        id: 'a',
        rowIndex: 0,
        vendorPartIdNormalized: '1',
        vendorPartIdRaw: '1',
        descriptionFromFile: null,
        uomFromFile: null,
        proposedCost: 1,
        matchStatus: 'CONFLICT_IN_FILE',
        partId: null,
        pn: null,
        nomenclature: null,
        costBefore: null,
        costAfter: null,
        percentChange: null,
        conflictGroupId: 'x',
        selected: false,
      },
    ],
  }),
);

console.log('vendor-price-duplicate-logic: all assertions passed');
