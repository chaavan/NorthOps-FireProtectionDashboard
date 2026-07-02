/**
 * Script to execute the SQL import for jobs from CSV
 * This script checks the schema and executes the SQL
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

async function checkSchema() {
  try {
    // Check if quantity_ordered column exists
    const result = await prisma.$queryRawUnsafe(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'jobs'
      ORDER BY ordinal_position;
    `) as Array<{ column_name: string; data_type: string; is_nullable: string }>;

    console.log('📋 Current database schema for jobs table:');
    console.log('─'.repeat(80));
    result.forEach(col => {
      console.log(`  ${col.column_name.padEnd(35)} ${col.data_type.padEnd(20)} ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });
    console.log('─'.repeat(80));
    console.log();

    // Check if quantity_ordered exists
    const hasQuantityOrdered = result.some(col => col.column_name === 'quantity_ordered');
    
    return { columns: result, hasQuantityOrdered };
  } catch (error) {
    console.error('❌ Error checking schema:', error);
    throw error;
  }
}

async function executeSQL() {
  try {
    // Read the SQL file
    const sqlPath = join(process.cwd(), 'scripts', 'import-jobs.sql');
    let sqlContent = readFileSync(sqlPath, 'utf-8');
    
    // Remove the warning lines at the top (lines 1-14)
    const lines = sqlContent.split('\n');
    const sqlLines = lines.slice(14); // Skip first 14 lines (warnings)
    sqlContent = sqlLines.join('\n');
    
    // Check schema first
    console.log('🔍 Checking database schema...\n');
    const { hasQuantityOrdered, columns } = await checkSchema();
    
    // Check if SQL includes quantity_ordered
    const sqlHasQuantityOrdered = sqlContent.includes('quantity_ordered') || sqlContent.includes('quantityOrdered');
    
    if (hasQuantityOrdered && !sqlHasQuantityOrdered) {
      console.log('⚠️  Database has quantity_ordered column but SQL does not include it.');
      console.log('   Updating SQL to include quantity_ordered (set to NULL)...\n');
      
      // Add quantity_ordered to INSERT statements
      sqlContent = sqlContent.replace(
        /INSERT INTO jobs \(\s*([^)]+)\s*\) VALUES/gi,
        (match, fields) => {
          if (!fields.includes('quantity_ordered')) {
            // Add quantity_ordered after quantity_needed
            const updatedFields = fields.replace(
              /quantity_needed\s*,/i,
              'quantity_needed,\n  quantity_ordered,'
            );
            return `INSERT INTO jobs (\n  ${updatedFields}\n) VALUES`;
          }
          return match;
        }
      );
      
      // Add NULL for quantity_ordered in VALUES
      sqlContent = sqlContent.replace(
        /(\d+),\s*'([^']+)',\s*'([^']+)'::timestamp,/gi,
        (match, qty, pulledBy, pulledDate) => {
          // This is after quantity_needed, add NULL for quantity_ordered
          return `${qty},\n  NULL,\n  '${pulledBy}',\n  '${pulledDate}'::timestamp,`;
        }
      );
      
      // Actually, let's do a simpler approach - add it after quantity_needed in VALUES
      sqlContent = sqlContent.replace(
        /(\s+)(\d+),\s*-- quantity_needed/gi,
        '$1$2,\n$1NULL, -- quantity_ordered'
      );
      
      // Better approach: find the pattern after quantity_needed value
      sqlContent = sqlContent.replace(
        /(\d+),\s*('Current User'|'[^']+'|NULL),\s*('2025-\d{2}-\d{2}'::timestamp|NULL),/gi,
        (match, qtyNeeded, pulledBy, pulledDate) => {
          return `${qtyNeeded},\n  NULL, -- quantity_ordered\n  ${pulledBy},\n  ${pulledDate},`;
        }
      );
    }
    
    // Split SQL into individual statements
    const statements = sqlContent
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    console.log(`📦 Found ${statements.length} SQL statements to execute\n`);
    console.log('🚀 Executing SQL statements...\n');
    
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (!statement.trim() || statement.trim().startsWith('--')) continue;
      
      try {
        await prisma.$executeRawUnsafe(statement);
        successCount++;
        if ((i + 1) % 10 === 0) {
          console.log(`  ✓ Processed ${i + 1}/${statements.length} statements...`);
        }
      } catch (error: any) {
        errorCount++;
        console.error(`  ❌ Error in statement ${i + 1}:`, error.message);
        // Continue with next statement
      }
    }
    
    console.log('\n' + '─'.repeat(80));
    console.log(`✅ Successfully executed: ${successCount} statements`);
    if (errorCount > 0) {
      console.log(`❌ Errors: ${errorCount} statements`);
    }
    console.log('─'.repeat(80));
    
  } catch (error) {
    console.error('❌ Error executing SQL:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

executeSQL();

