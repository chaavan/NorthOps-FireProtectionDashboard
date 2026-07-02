import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface CSVRow {
  'Job Number': string;
  'Job Name': string;
  'Contract #': string;
  'List #': string;
  'Area': string;
  'Location / Ship To': string;
  'Stocklist Date / Delivery Date / Ship Date': string;
  'Unit of Measurement': string;
  'Pulled': string;
  'Quantity Needed': string;
  'Pulled By': string;
  'Pulled Date': string;
  'Description': string;
  'Ordered?': string;
  'Recieved from Order?': string;
  'Delivered?': string;
  'Part Number': string;
  'Type': string;
  'Part Type': string;
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
        // Escaped quote
        current += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // End of field
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim()); // Push last field
  return result;
}

function parseCSV(filePath: string): CSVRow[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  const headers = parseCSVLine(lines[0]);
  const rows: CSVRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length !== headers.length) {
      console.warn(`Skipping row ${i + 1}: column count mismatch (expected ${headers.length}, got ${values.length})`);
      continue;
    }

    const row: any = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    rows.push(row as CSVRow);
  }

  return rows;
}

function parseInteger(value: string): number {
  if (!value || value.trim() === '') return 0;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? 0 : parsed;
}

function parseBoolean(value: string): boolean | null {
  if (!value || value.trim() === '') return null;
  const lower = value.trim().toLowerCase();
  if (lower === 'yes' || lower === 'true' || lower === '1') return true;
  if (lower === 'no' || lower === 'false' || lower === '0') return false;
  // Handle numeric values (treat > 0 as true)
  const num = parseInt(value, 10);
  if (!isNaN(num)) return num > 0;
  return null;
}

function parseDate(value: string): Date | null {
  if (!value || value.trim() === '') return null;
  const date = new Date(value.trim());
  return isNaN(date.getTime()) ? null : date;
}

async function importJobs() {
  try {
    const csvPath = path.join(process.cwd(), 'oldfiles', 'jobs.csv');
    console.log(`Reading CSV from: ${csvPath}`);

    const rows = parseCSV(csvPath);
    console.log(`Found ${rows.length} rows to import`);

    let imported = 0;
    let skipped = 0;
    let errors = 0;

    // Process in batches to avoid memory issues
    const batchSize = 50;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const createPromises = batch.map(async (row, batchIndex) => {
        try {
          // Skip rows without job number or part number (required for composite key)
          if (!row['Job Number'] || !row['Job Number'].trim()) {
            console.warn(`Skipping row ${i + batchIndex + 2}: missing Job Number`);
            skipped++;
            return;
          }

          // Handle empty part numbers - use a placeholder or skip
          let partNumber = row['Part Number']?.trim() || '';
          if (!partNumber) {
            // Generate a placeholder part number for rows without one
            partNumber = `NO_PART_${row['Job Number']}_${i + batchIndex}`;
            console.warn(`Row ${i + batchIndex + 2}: Empty Part Number, using placeholder: ${partNumber}`);
          }

          // Handle empty quantity needed - default to 0
          const quantityNeeded = parseInteger(row['Quantity Needed']);

          await prisma.job.upsert({
            where: {
              jobNumber_partNumber: {
                jobNumber: row['Job Number'].trim(),
                partNumber: partNumber,
              },
            },
            update: {
              jobName: row['Job Name']?.trim() || '',
              contractNumber: row['Contract #']?.trim() || null,
              listNumber: row['List #']?.trim() || null,
              area: row['Area']?.trim() || null,
              locationShipTo: row['Location / Ship To']?.trim() || null,
              stocklistDeliveryShipDate: parseDate(row['Stocklist Date / Delivery Date / Ship Date']),
              unitOfMeasurement: row['Unit of Measurement']?.trim() || null,
              pulled: parseInteger(row['Pulled']),
              quantityNeeded: quantityNeeded,
              pulledBy: row['Pulled By']?.trim() || null,
              pulledDate: parseDate(row['Pulled Date']),
              description: row['Description']?.trim() || null,
              ordered: parseBoolean(row['Ordered?']),
              receivedFromOrder: parseBoolean(row['Recieved from Order?']),
              delivered: parseBoolean(row['Delivered?']),
              type: row['Type']?.trim() || null,
              partType: row['Part Type']?.trim() || null,
            },
            create: {
              jobNumber: row['Job Number'].trim(),
              partNumber: partNumber,
              jobName: row['Job Name']?.trim() || '',
              contractNumber: row['Contract #']?.trim() || null,
              listNumber: row['List #']?.trim() || null,
              area: row['Area']?.trim() || null,
              locationShipTo: row['Location / Ship To']?.trim() || null,
              stocklistDeliveryShipDate: parseDate(row['Stocklist Date / Delivery Date / Ship Date']),
              unitOfMeasurement: row['Unit of Measurement']?.trim() || null,
              pulled: parseInteger(row['Pulled']),
              quantityNeeded: quantityNeeded,
              pulledBy: row['Pulled By']?.trim() || null,
              pulledDate: parseDate(row['Pulled Date']),
              description: row['Description']?.trim() || null,
              ordered: parseBoolean(row['Ordered?']),
              receivedFromOrder: parseBoolean(row['Recieved from Order?']),
              delivered: parseBoolean(row['Delivered?']),
              type: row['Type']?.trim() || null,
              partType: row['Part Type']?.trim() || null,
            },
          });
          imported++;
          if (imported % 10 === 0) {
            console.log(`Imported ${imported} jobs...`);
          }
        } catch (error) {
          errors++;
          console.error(`Error importing row ${i + batchIndex + 2}:`, error);
          if (error instanceof Error) {
            console.error(`Error message: ${error.message}`);
          }
        }
      });

      await Promise.all(createPromises);
    }

    console.log(`\nImport complete!`);
    console.log(`Successfully imported: ${imported} jobs`);
    console.log(`Skipped: ${skipped} rows`);
    console.log(`Errors: ${errors}`);
  } catch (error) {
    console.error('Import failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

importJobs();

