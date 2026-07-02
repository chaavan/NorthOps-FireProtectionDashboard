import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { extractTextFromPdfWithDocumentAi } from '../lib/jobImportDocumentAi';
import { parseTfMaterialPicksheet } from '../lib/jobImportTfParser';

async function verifySample0090(samplePath: string) {
  const fileBytes = fs.readFileSync(samplePath);
  const extraction = await extractTextFromPdfWithDocumentAi(fileBytes);
  const parsed = parseTfMaterialPicksheet(extraction.pages);

  assert.equal(extraction.layoutProfile, 'tf_material_picksheet_v1', 'expected TF layout profile');
  assert.equal(parsed.formatTrusted, true, 'expected deterministic parser to trust the sample layout');
  assert.equal(parsed.lineItems.length, 10, 'expected the sample picksheet to produce 10 material rows');
  assert.ok(parsed.materialPageNumbers.length > 0, 'expected the material table pages to be identified');

  const byPartNumber = new Map(parsed.lineItems.map((item) => [item.partNumber, item]));
  const orderedPartNumbers = parsed.lineItems.map((item) => item.partNumber);

  assert.ok(
    orderedPartNumbers.indexOf('1111000010') !== -1 &&
      orderedPartNumbers.indexOf('1111001005') !== -1 &&
      orderedPartNumbers.indexOf('1111000010') < orderedPartNumbers.indexOf('1111001005'),
    'expected 1111000010 to stay ahead of 1111001005',
  );
  assert.ok(
    orderedPartNumbers.indexOf('6000000010') !== -1 &&
      orderedPartNumbers.indexOf('AUTO-00001') !== -1 &&
      orderedPartNumbers.indexOf('6000000010') < orderedPartNumbers.indexOf('AUTO-00001'),
    'expected 6000000010 to stay ahead of AUTO-00001',
  );

  assert.match(byPartNumber.get('1111001005')?.description || '', /1 X 1\/2 RED ELL DI/i);
  assert.equal(byPartNumber.get('6000000010')?.quantityNeeded, 10, 'expected hanger row quantity to stay 10');
  assert.equal(byPartNumber.get('AUTO-00001')?.quantityNeeded, 1, 'expected whole saw row quantity to stay 1');

  return {
    sample: path.basename(samplePath),
    layoutProfile: extraction.layoutProfile,
    materialPages: parsed.materialPageNumbers,
    lineItemCount: parsed.lineItems.length,
    partNumbers: orderedPartNumbers,
  };
}

async function verifySample0100(samplePath: string) {
  const fileBytes = fs.readFileSync(samplePath);
  const extraction = await extractTextFromPdfWithDocumentAi(fileBytes);
  const parsed = parseTfMaterialPicksheet(extraction.pages);
  const byPartNumber = new Map(parsed.lineItems.map((item) => [item.partNumber, item]));

  assert.equal(extraction.layoutProfile, 'tf_material_picksheet_v1', 'expected TF layout profile for 0100 sample');
  assert.equal(parsed.formatTrusted, true, 'expected deterministic parser to trust the 0100 sample layout');
  assert.equal(parsed.lineItems.length, 29, 'expected the 0100 sample to produce 29 material rows');

  assert.equal(byPartNumber.get('00001DB020')?.unitOfMeasurement, 'FT');
  assert.match(byPartNumber.get('00001DB020')?.description || '', /SCH 10 PIPE/i);
  assert.equal(byPartNumber.get('1111000010')?.unitOfMeasurement, 'EA');
  assert.match(byPartNumber.get('1111000010')?.description || '', /ELL DI/i);
  assert.match(byPartNumber.get('4177A00010')?.description || '', /AUTO AIR VENT/i);
  assert.equal(byPartNumber.get('4177A00010')?.unitOfMeasurement, 'EA');
  assert.match(byPartNumber.get('6002000003')?.description || '', /TOP BEAM ZINC/i);
  assert.equal(byPartNumber.get('6002000003')?.unitOfMeasurement, 'EA');

  return {
    sample: path.basename(samplePath),
    layoutProfile: extraction.layoutProfile,
    lineItemCount: parsed.lineItems.length,
    checkedParts: ['00001DB020', '1111000010', '4177A00010', '6002000003'].map((partNumber) => ({
      partNumber,
      description: byPartNumber.get(partNumber)?.description || null,
      unitOfMeasurement: byPartNumber.get(partNumber)?.unitOfMeasurement || null,
    })),
  };
}

async function main() {
  const sample0090Path =
    process.env.JOB_IMPORT_SAMPLE_PDF?.trim() ||
    String.raw`C:\Users\chaav\Downloads\0090_001.pdf`;
  const sample0100Path =
    process.env.JOB_IMPORT_DESCRIPTION_SAMPLE_PDF?.trim() ||
    String.raw`C:\Users\chaav\Downloads\0100_001.pdf`;

  if (!fs.existsSync(sample0090Path)) {
    throw new Error(`Sample PDF not found at ${sample0090Path}`);
  }

  const results = [await verifySample0090(sample0090Path)];
  if (fs.existsSync(sample0100Path)) {
    results.push(await verifySample0100(sample0100Path));
  }

  console.log(JSON.stringify({ samples: results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
