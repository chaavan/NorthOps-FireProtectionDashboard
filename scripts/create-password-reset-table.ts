import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createPasswordResetTable() {
  try {
    console.log('Creating password_reset_requests table...');
    
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "password_reset_requests" (
        "id" TEXT NOT NULL,
        "email" TEXT NOT NULL,
        "hashed_password" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "password_reset_requests_pkey" PRIMARY KEY ("id")
      )
    `);

    console.log('Creating indexes...');
    
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "password_reset_requests_email_idx" ON "password_reset_requests"("email")
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "password_reset_requests_status_idx" ON "password_reset_requests"("status")
    `);

    console.log('✅ password_reset_requests table created successfully!');
  } catch (error) {
    console.error('Error creating table:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

createPasswordResetTable();


