/**
 * Script to execute the SQL import for jobs from CSV
 * This script reads the fixed SQL file and executes it
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

async function executeSQL() {
  try {
    // Read the SQL file
    const sqlPath = join(process.cwd(), 'scripts', 'import-jobs-fixed.sql');
    let sqlContent = readFileSync(sqlPath, 'utf-8');
    
    // Remove the warning lines at the top (everything before "-- Import jobs")
    const importIndex = sqlContent.indexOf('-- Import jobs');
    if (importIndex > 0) {
      sqlContent = sqlContent.substring(importIndex);
    }
    
    // Split SQL into individual statements
    // Each statement ends with a semicolon followed by newline(s)
    const statements: string[] = [];
    let currentStatement = '';
    const lines = sqlContent.split('\n');
    
    for (const line of lines) {
      currentStatement += line + '\n';
      // Check if this line ends the statement (semicolon followed by optional whitespace)
      if (line.trim().endsWith(';')) {
        const trimmed = currentStatement.trim();
        if (trimmed.length > 0 && trimmed.toUpperCase().includes('INSERT INTO JOBS')) {
          statements.push(trimmed);
        }
        currentStatement = '';
      }
    }
    
    // Add any remaining statement
    if (currentStatement.trim().length > 0 && currentStatement.toUpperCase().includes('INSERT')) {
      statements.push(currentStatement.trim());
    }
    
    console.log(`📦 Found ${statements.length} SQL INSERT statements to execute\n`);
    console.log('🚀 Executing SQL statements...\n');
    
    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i] + ';'; // Add semicolon back
      if (!statement.trim() || statement.trim().startsWith('--')) continue;
      
      try {
        await prisma.$executeRawUnsafe(statement);
        successCount++;
        if ((i + 1) % 10 === 0) {
          console.log(`  ✓ Processed ${i + 1}/${statements.length} statements...`);
        }
      } catch (error: any) {
        errorCount++;
        const errorMsg = error.message || String(error);
        errors.push(`Statement ${i + 1}: ${errorMsg.substring(0, 100)}`);
        if (errorCount <= 5) {
          console.error(`  ❌ Error in statement ${i + 1}:`, errorMsg.substring(0, 200));
        }
      }
    }
    
    console.log('\n' + '─'.repeat(80));
    console.log(`✅ Successfully executed: ${successCount} statements`);
    if (errorCount > 0) {
      console.log(`❌ Errors: ${errorCount} statements`);
      if (errors.length > 0 && errors.length <= 10) {
        console.log('\nFirst few errors:');
        errors.slice(0, 5).forEach(err => console.log(`  - ${err}`));
      }
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

