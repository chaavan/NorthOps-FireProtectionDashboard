/**
 * Script to generate SQL INSERT statements from jobs.csv
 * Run with: npx ts-node scripts/import-jobs-from-csv.ts
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';

// Helper function to escape SQL strings
function escapeSql(str: string | null | undefined): string {
  if (!str || str.trim() === '') return 'NULL';
  return `'${str.replace(/'/g, "''")}'`;
}

// Helper function to convert Yes/No to boolean
function parseBoolean(value: string | null | undefined): string {
  if (!value || value.trim() === '') return 'NULL';
  const upper = value.trim().toUpperCase();
  if (upper === 'YES' || upper === 'TRUE' || upper === '1') return 'true';
  if (upper === 'NO' || upper === 'FALSE' || upper === '0') return 'false';
  return 'NULL';
}

// Helper function to parse date
function parseDate(value: string | null | undefined): string {
  if (!value || value.trim() === '') return 'NULL';
  const trimmed = value.trim();
  // Try to parse the date - format appears to be YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `'${trimmed}'::timestamp`;
  }
  return 'NULL';
}

// Helper function to parse integer
function parseInteger(value: string | null | undefined, defaultValue: number = 0): string {
  if (!value || value.trim() === '') return defaultValue.toString();
  const parsed = parseInt(value.trim(), 10);
  return isNaN(parsed) ? defaultValue.toString() : parsed.toString();
}

function generateSQL() {
  const csvPath = join(process.cwd(), 'oldfiles', 'jobs.csv');
  const csvContent = readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n').filter(line => line.trim());
  
  // Skip header row
  const dataLines = lines.slice(1);
  
  const sqlStatements: string[] = [];
  
  sqlStatements.push('-- Import jobs from CSV');
  sqlStatements.push('-- This script uses INSERT ... ON CONFLICT to update existing records');
  sqlStatements.push('');
  
  for (const line of dataLines) {
    // Parse CSV line (handling quoted fields)
    const fields: string[] = [];
    let currentField = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          // Escaped quote
          currentField += '"';
          i++;
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        fields.push(currentField);
        currentField = '';
      } else {
        currentField += char;
      }
    }
    fields.push(currentField); // Add last field
    
    if (fields.length < 19) continue; // Skip incomplete rows
    
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
    if (!jobNumber || !jobName || !partNumber) continue;
    
    // Build INSERT statement with ON CONFLICT
    const sql = `
INSERT INTO jobs (
  job_number,
  job_name,
  contract_number,
  list_number,
  area,
  location_ship_to,
  stocklist_delivery_ship_date,
  unit_of_measurement,
  pulled,
  quantity_needed,
  quantity_ordered,
  pulled_by,
  pulled_date,
  description,
  ordered,
  received_from_order,
  delivered,
  part_number,
  type,
  part_type,
  "createdAt",
  "updatedAt"
) VALUES (
  ${escapeSql(jobNumber)},
  ${escapeSql(jobName)},
  ${escapeSql(contractNumber)},
  ${escapeSql(listNumber)},
  ${escapeSql(area)},
  ${escapeSql(locationShipTo)},
  ${parseDate(stocklistDate)},
  ${escapeSql(unitOfMeasurement)},
  ${parseInteger(pulled, 0)},
  ${parseInteger(quantityNeeded, 0)},
  NULL,
  ${escapeSql(pulledBy)},
  ${parseDate(pulledDate)},
  ${escapeSql(description)},
  ${parseBoolean(ordered)},
  ${parseBoolean(receivedFromOrder)},
  ${parseBoolean(delivered)},
  ${escapeSql(partNumber)},
  ${escapeSql(type)},
  ${escapeSql(partType)},
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT (job_number, part_number) 
DO UPDATE SET
  job_name = EXCLUDED.job_name,
  contract_number = EXCLUDED.contract_number,
  list_number = EXCLUDED.list_number,
  area = EXCLUDED.area,
  location_ship_to = EXCLUDED.location_ship_to,
  stocklist_delivery_ship_date = EXCLUDED.stocklist_delivery_ship_date,
  unit_of_measurement = EXCLUDED.unit_of_measurement,
  pulled = EXCLUDED.pulled,
  quantity_needed = EXCLUDED.quantity_needed,
  quantity_ordered = EXCLUDED.quantity_ordered,
  pulled_by = EXCLUDED.pulled_by,
  pulled_date = EXCLUDED.pulled_date,
  description = EXCLUDED.description,
  ordered = EXCLUDED.ordered,
  received_from_order = EXCLUDED.received_from_order,
  delivered = EXCLUDED.delivered,
  type = EXCLUDED.type,
  part_type = EXCLUDED.part_type,
  "updatedAt" = CURRENT_TIMESTAMP;
`.trim();
    
    sqlStatements.push(sql);
  }
  
  return sqlStatements.join('\n\n');
}

const sql = generateSQL();
console.log(sql);

