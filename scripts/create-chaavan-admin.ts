/**
 * Script to create chaavan as an admin user
 * Run with: npx ts-node scripts/create-chaavan-admin.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function createChaavanAdmin() {
  const email = 'surechaavanchidroop@gmail.com';
  const password = 'CMD*5sure005';
  const name = 'chaavan';

  try {
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      console.log(`⚠️  User with email ${email} already exists`);
      console.log('Updating role to ADMIN and password...');
      
      const updatedUser = await prisma.user.update({
        where: { email },
        data: {
          role: 'ADMIN',
          name: name,
          password: hashedPassword,
        },
      });
      
      console.log('✅ User updated successfully!');
      console.log('User details:', {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
      });
      console.log('🔑 Password updated to: ' + password);
      return;
    }

    // Create admin user
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: 'ADMIN',
        emailVerified: new Date(),
      },
    });

    console.log('✅ Admin user "chaavan" created successfully!');
    console.log('📧 Email:', email);
    console.log('🔑 Password:', password);
    console.log('⚠️  Please change the password after first login!');
    console.log('');
    console.log('User details:', {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
  } catch (error) {
    console.error('❌ Error creating admin user:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createChaavanAdmin();

