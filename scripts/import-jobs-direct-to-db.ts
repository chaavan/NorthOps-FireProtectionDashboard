/**
 * Script to import jobs directly from CSV to database
 * This bypasses SQL file generation and inserts directly
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

// Helper function to parse CSV line
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let currentField = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(currentField);
      currentField = '';
    } else {
      currentField += char;
    }
  }
  fields.push(currentField);
  return fields;
}

// Helper function to parse date
function parseDate(value: string | null | undefined): Date | null {
  if (!value || value.trim() === '') return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(trimmed + 'T12:00:00');
  }
  return null;
}

// Helper function to parse boolean
function parseBoolean(value: string | null | undefined): boolean | null {
  if (!value || value.trim() === '') return null;
  const upper = value.trim().toUpperCase();
  if (upper === 'YES' || upper === 'TRUE' || upper === '1') return true;
  if (upper === 'NO' || upper === 'FALSE' || upper === '0') return false;
  return null;
}

// Helper function to parse integer
function parseInteger(value: string | null | undefined, defaultValue: number = 0): number {
  if (!value || value.trim() === '') return defaultValue;
  const parsed = parseInt(value.trim(), 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

async function importJobs() {
  try {
    // Check schema first
    console.log('🔍 Checking database schema...\n');
    const schema = await prisma.$queryRawUnsafe(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'jobs'
      ORDER BY ordinal_position;
    `) as Array<{ column_name: string }>;
    
    const hasQuantityOrdered = schema.some(col => col.column_name === 'quantity_ordered');
    console.log(`✓ Schema check complete. quantity_ordered column: ${hasQuantityOrdered ? 'EXISTS' : 'MISSING'}\n`);
    
    // Read CSV file
    const csvPath = join(process.cwd(), 'oldfiles', 'jobs.csv');
    const csvContent = readFileSync(csvPath, 'utf-8');
    const lines = csvContent.split('\n').filter(line => line.trim());
    
    // Skip header row
    const dataLines = lines.slice(1);
    
    console.log(`📦 Found ${dataLines.length} rows in CSV\n`);
    console.log('🚀 Importing jobs...\n');
    
    let successCount = 0;
    let errorCount = 0;
    const errors: Array<{ row: number; error: string }> = [];
    
    for (let i = 0; i < dataLines.length; i++) {
      const line = dataLines[i];
      if (!line.trim()) continue;
      
      try {
        const fields = parseCSVLine(line);
        
        if (fields.length < 19) {
          console.log(`  ⚠️  Row ${i + 2}: Skipping incomplete row (${fields.length} fields)`);
          continue;
        }
        
        const [
          jobNumber,
          jobName,
          contractNumber,
          listNumber,
          area,
          locationShipTo,
          stocklistDate,
          unitOfMeasurement,
          pulled,
          quantityNeeded,
          pulledBy,
          pulledDate,
          description,
          ordered,
          receivedFromOrder,
          delivered,
          partNumber,
          type,
          partType
        ] = fields;
        
        // Skip rows without required fields
        if (!jobNumber || !jobName || !partNumber) {
          console.log(`  ⚠️  Row ${i + 2}: Skipping row with missing required fields`);
          continue;
        }
        
        // Use upsert (create or update)
        await prisma.job.upsert({
          where: {
            jobNumber_partNumber: {
              jobNumber: jobNumber.trim(),
              partNumber: partNumber.trim(),
            },
          },
          update: {
            jobName: jobName.trim(),
            contractNumber: contractNumber?.trim() || null,
            listNumber: listNumber?.trim() || null,
            area: area?.trim() || null,
            locationShipTo: locationShipTo?.trim() || null,
            stocklistDeliveryShipDate: parseDate(stocklistDate),
            unitOfMeasurement: unitOfMeasurement?.trim() || null,
            pulled: parseInteger(pulled, 0),
            quantityNeeded: parseInteger(quantityNeeded, 0),
            quantityOrdered: null, // CSV doesn't have this field
            pulledBy: pulledBy?.trim() || null,
            pulledDate: parseDate(pulledDate),
            description: description?.trim() || null,
            ordered: parseBoolean(ordered),
            receivedFromOrder: parseBoolean(receivedFromOrder),
            delivered: parseBoolean(delivered),
            type: type?.trim() || null,
            partType: partType?.trim() || null,
          },
          create: {
            jobNumber: jobNumber.trim(),
            jobName: jobName.trim(),
            partNumber: partNumber.trim(),
            contractNumber: contractNumber?.trim() || null,
            listNumber: listNumber?.trim() || null,
            area: area?.trim() || null,
            locationShipTo: locationShipTo?.trim() || null,
            stocklistDeliveryShipDate: parseDate(stocklistDate),
            unitOfMeasurement: unitOfMeasurement?.trim() || null,
            pulled: parseInteger(pulled, 0),
            quantityNeeded: parseInteger(quantityNeeded, 0),
            quantityOrdered: null,
            pulledBy: pulledBy?.trim() || null,
            pulledDate: parseDate(pulledDate),
            description: description?.trim() || null,
            ordered: parseBoolean(ordered),
            receivedFromOrder: parseBoolean(receivedFromOrder),
            delivered: parseBoolean(delivered),
            type: type?.trim() || null,
            partType: partType?.trim() || null,
          },
        });
        
        successCount++;
        if ((i + 1) % 10 === 0 || i === 0) {
          console.log(`  ✓ Processed ${i + 1}/${dataLines.length} rows...`);
        }
      } catch (error: any) {
        errorCount++;
        const errorMsg = error.message || String(error);
        errors.push({ row: i + 2, error: errorMsg });
        if (errorCount <= 5) {
          console.error(`  ❌ Error in row ${i + 2}:`, errorMsg.substring(0, 150));
        }
      }
    }
    
    console.log('\n' + '─'.repeat(80));
    console.log(`✅ Successfully imported: ${successCount} job records`);
    if (errorCount > 0) {
      console.log(`❌ Errors: ${errorCount} rows`);
      if (errors.length > 0 && errors.length <= 5) {
        console.log('\nError details:');
        errors.forEach(({ row, error }) => {
          console.log(`  Row ${row}: ${error.substring(0, 150)}`);
        });
      }
    } else {
      console.log('🎉 All jobs imported successfully!');
    }
    console.log('─'.repeat(80));
    
  } catch (error) {
    console.error('❌ Error importing jobs:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

importJobs();

