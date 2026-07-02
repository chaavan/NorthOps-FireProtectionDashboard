/**
 * Dry-run ETNA parser + optional DB match rate.
 *
 *   npx tsx scripts/test-vendor-price-import.ts path/to/Book1.xlsx
 *   npx tsx scripts/test-vendor-price-import.ts path/to/Book1.xlsx --match
 */
import 'dotenv/config';
import fs from 'fs';
import assert from 'assert';
import { parseEtnaBook1V1 } from '../lib/vendorPriceImport/parsers/etnaBook1V1';
import { normalizeVendorPartId } from '../lib/vendorPriceImport/vendorPartIdNormalize';
import { computePercentChange } from '../lib/vendorPriceImport/percentChange';
import { matchParsedRowsToParts } from '../lib/vendorPriceImport/matchVendorPrices';
import { prisma } from '../lib/prisma';
import { normalizeVendorKey } from '../lib/vendorUtils';

async function main() {
  const filePath = process.argv[2];
  const withMatch = process.argv.includes('--match');

  assert.ok(filePath, 'Usage: npx tsx scripts/test-vendor-price-import.ts <file.xlsx> [--match]');

  const bytes = fs.readFileSync(filePath);
  const parsed = parseEtnaBook1V1(bytes, filePath);

  const idCounts = new Map<string, number>();
  for (const row of parsed) {
    idCounts.set(row.vendorPartIdNormalized, (idCounts.get(row.vendorPartIdNormalized) || 0) + 1);
  }
  const dupGroups = [...idCounts.entries()].filter(([, c]) => c > 1);

  console.log('Parsed rows:', parsed.length);
  console.log('Unique vendor IDs:', idCounts.size);
  console.log('Duplicate ID groups in file:', dupGroups.length);
  console.log('Sample rows:', parsed.slice(0, 3));

  assert.equal(normalizeVendorPartId('54350.0'), '54350');
  assert.equal(computePercentChange(10, 11), 10);

  if (!withMatch) {
    console.log('\nPass (parse only). Add --match to compare against database.');
    return;
  }

  const parts = await prisma.part.findMany({
    where: { vendorPartID: { not: null }, vendor: { not: null } },
    select: {
      id: true,
      pn: true,
      nomenclature: true,
      cost: true,
      vendor: true,
      vendorPartID: true,
    },
  });
  const etnaParts = parts.filter((p) => normalizeVendorKey(p.vendor) === 'etna');
  const drafts = matchParsedRowsToParts({
    parsedRows: parsed,
    parts: etnaParts,
    matchVendorKey: 'etna',
  });

  const matched = drafts.filter((d) => d.matchStatus === 'MATCHED').length;
  const conflicts = drafts.filter((d) => d.matchStatus === 'CONFLICT_IN_FILE').length;
  const unmatched = drafts.filter((d) => d.matchStatus === 'UNMATCHED').length;
  const noChange = drafts.filter((d) => d.matchStatus === 'NO_COST_CHANGE').length;

  console.log('\nDB ETNA parts with vendorPartID:', etnaParts.length);
  console.log('Matched (price change):', matched);
  console.log('No cost change:', noChange);
  console.log('Unmatched file rows:', unmatched);
  console.log('Conflict-in-file rows:', conflicts);
  console.log(
    'Match rate (matched / non-conflict parsed):',
    `${((matched / Math.max(1, parsed.length - conflicts)) * 100).toFixed(1)}%`,
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
