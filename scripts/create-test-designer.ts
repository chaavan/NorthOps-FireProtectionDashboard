/**
 * Script to create test_designer as a designer user
 * Run with: npx ts-node scripts/create-test-designer.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function createTestDesigner() {
  const email = 'test_designer@totalfire.biz';
  const password = 'test123';
  const name = 'test_designer';

  try {
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      console.log(`⚠️  User with email ${email} already exists`);
      console.log('Updating role to DESIGNER...');
      
      const updatedUser = await prisma.user.update({
        where: { email },
        data: {
          role: 'DESIGNER',
          name: name,
        },
      });
      
      console.log('✅ User role updated to DESIGNER!');
      console.log('User details:', {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
      });
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create designer user
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: 'DESIGNER',
        emailVerified: new Date(),
      },
    });

    console.log('✅ Designer user "test_designer" created successfully!');
    console.log('📧 Email:', email);
    console.log('🔑 Password:', password);
    console.log('👤 Role: DESIGNER (Puller tab only)');
    console.log('');
    console.log('User details:', {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
  } catch (error) {
    console.error('❌ Error creating designer user:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTestDesigner();






