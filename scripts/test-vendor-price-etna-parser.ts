import assert from 'assert';
import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { parseEtnaBook1V1 } from '../lib/vendorPriceImport/parsers/etnaBook1V1';
import { classifyDuplicateVendorIds, matchParsedRowsToParts } from '../lib/vendorPriceImport/matchVendorPrices';
import {
  groupIsFullyEquivalent,
  normalizeDescriptionForCompare,
  rowsAreEquivalentForVendorId,
} from '../lib/vendorPriceImport/normalizeVendorRow';
import { normalizeVendorPartId } from '../lib/vendorPriceImport/vendorPartIdNormalize';
import { Prisma } from '@prisma/client';

function buildFixtureXlsx(): Buffer {
  const fixturePath = path.join(process.cwd(), 'test-fixtures', 'vendor-price-etna-rows.json');
  const rows = JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as unknown[][];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

assert.equal(normalizeDescriptionForCompare('  hello  world  '), 'HELLO WORLD');

const bytes = buildFixtureXlsx();
const parsed = parseEtnaBook1V1(bytes, 'fixture.xlsx');

assert.equal(parsed.length, 6, 'expected 6 data rows from fixture');

const classification = classifyDuplicateVendorIds(parsed);
assert.equal(classification.conflictGroupByRowIndex.size, 2, '48341 price mismatch = 2 conflict rows');
assert.equal(classification.collapsedRowIndexes.size, 2, '16683: 2 collapsed duplicate rows');
assert.ok(classification.rowsToMatchIndexes.has(parsed.find((r) => r.vendorPartIdNormalized === '16683')!.rowIndex));

const dup48341 = parsed.filter((r) => r.vendorPartIdNormalized === '48341');
assert.equal(dup48341.length, 2);
assert.equal(groupIsFullyEquivalent(dup48341), false);
assert.equal(rowsAreEquivalentForVendorId(dup48341[0], dup48341[1]), false);

const dup16683 = parsed.filter((r) => r.vendorPartIdNormalized === '16683');
assert.equal(dup16683.length, 3);
assert.equal(groupIsFullyEquivalent(dup16683), true);

const mockParts = [
  {
    id: 'part-1',
    pn: '00004DB005',
    nomenclature: '1/2 pipe',
    cost: new Prisma.Decimal(0.98),
    vendor: 'ETNA',
    vendorPartID: '48341',
  },
  {
    id: 'part-2',
    pn: 'PIPE234',
    nomenclature: '3/8 pipe',
    cost: new Prisma.Decimal(3.5),
    vendor: 'ETNA',
    vendorPartID: '234729',
  },
  {
    id: 'part-16683',
    pn: 'VALVE16683',
    nomenclature: 'VIC 717 8 FIRELOCK CHECK VALVE',
    cost: new Prisma.Decimal(900),
    vendor: 'ETNA',
    vendorPartID: '16683',
  },
];

const drafts = matchParsedRowsToParts({
  parsedRows: parsed,
  parts: mockParts,
  matchVendorKey: 'etna',
});

const conflictRows = drafts.filter((d) => d.matchStatus === 'CONFLICT_IN_FILE');
assert.equal(conflictRows.length, 2, 'only differing-price 48341 rows should conflict');

const collapsed = drafts.filter((d) => d.matchStatus === 'DUPLICATE_COLLAPSED');
assert.equal(collapsed.length, 2, 'two extra 16683 rows collapsed');

const matched16683 = drafts.filter(
  (d) => d.vendorPartIdNormalized === '16683' && d.matchStatus === 'MATCHED',
);
assert.equal(matched16683.length, 1, 'one representative 16683 row should match');
assert.equal(matched16683[0]?.selected, true);

const matched234 = drafts.find(
  (d) => d.vendorPartIdNormalized === '234729' && d.matchStatus === 'MATCHED',
);
assert.ok(matched234, '234729 should match part-2');

console.log('vendor-price-etna-parser: all assertions passed');
