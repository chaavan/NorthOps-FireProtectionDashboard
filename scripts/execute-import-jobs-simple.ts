/**
 * Script to execute the SQL import for jobs from CSV
 * Simple execution approach
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

async function executeSQL() {
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
    
    // Read the SQL file
    const sqlPath = join(process.cwd(), 'scripts', 'import-jobs-fixed.sql');
    const sqlContent = readFileSync(sqlPath, 'utf-8');
    
    // Find where SQL starts
    const sqlStart = sqlContent.indexOf('-- Import jobs');
    let cleanSQL = sqlStart > 0 ? sqlContent.substring(sqlStart) : sqlContent;
    
    // Remove all comment lines
    cleanSQL = cleanSQL.replace(/^--.*$/gm, '');
    
    // Split by pattern: INSERT ... ; followed by optional whitespace
    // Use a more robust regex that captures the entire statement
    const statementRegex = /INSERT\s+INTO\s+jobs\s*\([^)]+\)\s*VALUES\s*\([^)]+\)\s*ON\s+CONFLICT[^;]+;/gi;
    const statements: string[] = [];
    let match;
    
    while ((match = statementRegex.exec(cleanSQL)) !== null) {
      statements.push(match[0].trim());
    }
    
    // If regex didn't work, try splitting by semicolon and filtering
    if (statements.length === 0) {
      const parts = cleanSQL.split(';');
      let current = '';
      for (const part of parts) {
        current += part + ';';
        if (current.toUpperCase().includes('INSERT INTO JOBS') && 
            current.toUpperCase().includes('ON CONFLICT') &&
            current.trim().endsWith(';')) {
          statements.push(current.trim());
          current = '';
        }
      }
    }
    
    console.log(`📦 Found ${statements.length} SQL INSERT statements to execute\n`);
    
    if (statements.length === 0) {
      console.log('⚠️  No statements found. Showing first 500 chars of SQL:');
      console.log(cleanSQL.substring(0, 500));
      return;
    }
    
    console.log('🚀 Executing SQL statements...\n');
    
    let successCount = 0;
    let errorCount = 0;
    const errors: Array<{ index: number; error: string }> = [];
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      try {
        await prisma.$executeRawUnsafe(statement);
        successCount++;
        if ((i + 1) % 5 === 0 || i === 0) {
          console.log(`  ✓ Processed ${i + 1}/${statements.length} statements...`);
        }
      } catch (error: any) {
        errorCount++;
        const errorMsg = error.message || String(error);
        errors.push({ index: i + 1, error: errorMsg });
        if (errorCount <= 3) {
          console.error(`  ❌ Error in statement ${i + 1}:`, errorMsg.substring(0, 200));
          console.error(`     Statement preview: ${statement.substring(0, 100)}...`);
        }
      }
    }
    
    console.log('\n' + '─'.repeat(80));
    console.log(`✅ Successfully executed: ${successCount} statements`);
    if (errorCount > 0) {
      console.log(`❌ Errors: ${errorCount} statements`);
      if (errors.length > 0 && errors.length <= 5) {
        console.log('\nError details:');
        errors.forEach(({ index, error }) => {
          console.log(`  Statement ${index}: ${error.substring(0, 150)}`);
        });
      }
    } else {
      console.log('🎉 All jobs imported successfully!');
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

