import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../lib/prisma';
import { COST_CONTEXT_IMPORT, recordPartCostChange } from '../lib/partCostLedger';

interface CSVRow {
  Company: string;
  PN: string;
  Whse: string;
  Nomenclature: string;
  Cost: string;
  Retail: string;
  Type: string;
  Weight: string;
  Units: string;
  AltPN: string;
  Code: string;
  Vendor: string;
  'Date Updated': string;
  'Vendor PartID': string;
  'Cost Change percentage': string;
  Status: string;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(filePath: string): CSVRow[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter((line) => line.trim());
  const headers = parseCSVLine(lines[0]);
  const rows: CSVRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length !== headers.length) {
      console.warn(`Skipping row ${i + 1}: column count mismatch`);
      continue;
    }

    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    rows.push(row as CSVRow);
  }

  return rows;
}

function parseDecimal(value: string): number {
  if (!value || value.trim() === '') return 0;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

function parseInteger(value: string): number {
  if (!value || value.trim() === '') return 0;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? 0 : parsed;
}

async function resolveImportActorUserId(): Promise<string | null> {
  const fromEnv = process.env.PARTS_IMPORT_ACTOR_USER_ID?.trim();
  if (fromEnv) return fromEnv;
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return admin?.id ?? null;
}

async function importParts() {
  try {
    if (process.env.PARTS_BULK_IMPORT_CONFIRM !== 'I_UNDERSTAND') {
      throw new Error(
        'Refusing to run: set PARTS_BULK_IMPORT_CONFIRM=I_UNDERSTAND (bulk import writes Part rows and IMPORT cost audit rows).',
      );
    }

    const actorUserId = await resolveImportActorUserId();
    if (!actorUserId) {
      throw new Error(
        'No actor user for cost audit rows. Set PARTS_IMPORT_ACTOR_USER_ID to a User.id or ensure an ADMIN user exists.',
      );
    }

    const batchId = `import-parts:${new Date().toISOString()}`;
    console.log(`Import batch id: ${batchId}`);
    console.log(`Actor user id: ${actorUserId}\n`);

    const csvPath = path.join(process.cwd(), 'oldfiles', 'parts.csv');
    console.log(`Reading CSV from: ${csvPath}`);

    const rows = parseCSV(csvPath);
    console.log(`Found ${rows.length} rows to import`);

    let imported = 0;
    let errors = 0;

    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const createPromises = batch.map(async (row) => {
        try {
          const costVal = parseDecimal(row.Cost);
          await prisma.$transaction(async (tx) => {
            const created = await tx.part.create({
              data: {
                company: parseInteger(row.Company),
                pn: row.PN || '',
                whse: parseInteger(row.Whse),
                nomenclature: row.Nomenclature || '',
                cost: costVal,
                type: parseInteger(row.Type),
                weight: row.Weight && row.Weight.trim() ? parseDecimal(row.Weight) : null,
                units: row.Units || '',
                altPN: row.AltPN && row.AltPN.trim() ? row.AltPN : null,
                code: row.Code && row.Code.trim() ? row.Code : null,
                vendor: row.Vendor && row.Vendor.trim() ? row.Vendor : null,
                dateUpdated: row['Date Updated'] && row['Date Updated'].trim() ? row['Date Updated'] : null,
                vendorPartID: row['Vendor PartID'] && row['Vendor PartID'].trim() ? row['Vendor PartID'] : null,
                costChangePercentage:
                  row['Cost Change percentage'] && row['Cost Change percentage'].trim()
                    ? row['Cost Change percentage']
                    : null,
                status: row.Status && row.Status.trim() ? row.Status : null,
              },
            });

            await recordPartCostChange(tx, {
              partId: created.id,
              costBefore: null,
              costAfter: costVal,
              actorUserId,
              contextType: COST_CONTEXT_IMPORT,
              contextId: batchId,
              note: `CSV import | PN ${created.pn} | opening cost ${costVal.toFixed(2)}`,
            });
          });
          imported++;
          if (imported % 100 === 0) {
            console.log(`Imported ${imported} parts...`);
          }
        } catch (error) {
          errors++;
          console.error(`Error importing row ${i + batch.indexOf(row) + 2}:`, error);
        }
      });

      await Promise.all(createPromises);
    }

    console.log(`\nImport complete!`);
    console.log(`Successfully imported: ${imported} parts`);
    console.log(`Errors: ${errors}`);
  } catch (error) {
    console.error('Import failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

importParts();
