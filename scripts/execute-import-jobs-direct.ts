/**
 * Script to execute the SQL import for jobs from CSV
 * Direct execution approach
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

async function checkSchema() {
  try {
    const result = await prisma.$queryRawUnsafe(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'jobs'
      ORDER BY ordinal_position;
    `) as Array<{ column_name: string; data_type: string; is_nullable: string }>;

    console.log('📋 Database schema for jobs table:');
    console.log('─'.repeat(80));
    result.forEach(col => {
      console.log(`  ${col.column_name.padEnd(35)} ${col.data_type.padEnd(20)} ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });
    console.log('─'.repeat(80));
    console.log();
    
    return result;
  } catch (error) {
    console.error('❌ Error checking schema:', error);
    throw error;
  }
}

async function executeSQL() {
  try {
    // Check schema first
    console.log('🔍 Checking database schema...\n');
    await checkSchema();
    
    // Read the SQL file
    const sqlPath = join(process.cwd(), 'scripts', 'import-jobs-fixed.sql');
    const sqlContent = readFileSync(sqlPath, 'utf-8');
    
    // Find where SQL starts (after warnings)
    const sqlStart = sqlContent.indexOf('-- Import jobs');
    let cleanSQL = sqlStart > 0 ? sqlContent.substring(sqlStart) : sqlContent;
    
    // Remove comment lines
    cleanSQL = cleanSQL.replace(/^--.*$/gm, '');
    
    // Split into statements - each INSERT statement ends with semicolon followed by newline(s)
    const statements: string[] = [];
    let currentStatement = '';
    let inStatement = false;
    
    const lines = cleanSQL.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed.toUpperCase().startsWith('INSERT INTO JOBS')) {
        if (currentStatement.trim()) {
          statements.push(currentStatement.trim());
        }
        currentStatement = line + '\n';
        inStatement = true;
      } else if (inStatement) {
        currentStatement += line + '\n';
        if (trimmed.endsWith(';')) {
          statements.push(currentStatement.trim());
          currentStatement = '';
          inStatement = false;
        }
      }
    }
    
    // Add last statement if any
    if (currentStatement.trim()) {
      statements.push(currentStatement.trim());
    }
    
    console.log(`📦 Found ${statements.length} SQL INSERT statements to execute\n`);
    console.log('🚀 Executing SQL statements...\n');
    
    let successCount = 0;
    let errorCount = 0;
    const errors: Array<{ index: number; error: string }> = [];
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      try {
        await prisma.$executeRawUnsafe(statement);
        successCount++;
        if ((i + 1) % 5 === 0) {
          console.log(`  ✓ Processed ${i + 1}/${statements.length} statements...`);
        }
      } catch (error: any) {
        errorCount++;
        const errorMsg = error.message || String(error);
        errors.push({ index: i + 1, error: errorMsg });
        if (errorCount <= 3) {
          console.error(`  ❌ Error in statement ${i + 1}:`, errorMsg.substring(0, 150));
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
          console.log(`  Statement ${index}: ${error.substring(0, 100)}`);
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

