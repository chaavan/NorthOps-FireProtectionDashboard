import fs from 'fs';
import { parseHydraTecExport } from '@/lib/jobImportHydraTecParser';

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: tsx scripts/test-hydratec-parser.ts <path-to.hvuf>');
  process.exit(1);
}

const bytes = fs.readFileSync(filePath);
const result = parseHydraTecExport(bytes);

console.log('=== Job Info ===');
console.log(result.jobInfo);

console.log('\n=== Parse Issues ===');
console.log(result.deterministicResult.issues);

console.log('\n=== formatTrusted ===', result.deterministicResult.formatTrusted);
console.log('=== materialPageNumbers ===', result.deterministicResult.materialPageNumbers);

console.log(`\n=== Line Items (${result.deterministicResult.lineItems.length}) ===`);
for (const item of result.deterministicResult.lineItems) {
  console.log(
    `[${item.sectionName || '-'}] ${item.partNumber} | loose=${item.quantityLoose} fab=${item.quantityFab} total=${item.quantityNeeded} ${item.unitOfMeasurement || ''} | ${item.description} | warnings=${item.warnings.join(',')}`,
  );
}
