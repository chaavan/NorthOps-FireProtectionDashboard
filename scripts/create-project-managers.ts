/**
 * Script to create project manager users
 * Run with: npx ts-node scripts/create-project-managers.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const projectManagers = [
  { name: 'Erich Nelson', email: 'Enelson@totalfire.biz' },
  { name: 'Jake Webber', email: 'jwebber@totalfire.biz' },
  { name: 'Lou Markel', email: 'lmarkel@totalfire.biz' },
  { name: 'Dennis Kiliszewski', email: 'dkiliszewski@totalfire.biz' },
  { name: 'Bill Drew', email: 'wdrew@totalfire.biz' },
  { name: 'Matt Rock', email: 'mrock@totalfire.biz' },
  { name: 'David Steinmetz', email: 'dsteinmetz@totalfire.biz' },
];

const password = 'test1234';

async function createProjectManagers() {
  try {
    // Hash password once for all users
    const hashedPassword = await bcrypt.hash(password, 10);

    console.log('🔐 Creating project manager users...\n');

    for (const userData of projectManagers) {
      const normalizedEmail = userData.email.trim().toLowerCase();
      
      try {
        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
          where: { email: normalizedEmail },
        });

        if (existingUser) {
          console.log(`⚠️  User with email ${normalizedEmail} already exists`);
          console.log('   Updating role to PROJECT_MANAGER and password...');
          
          const updatedUser = await prisma.user.update({
            where: { email: normalizedEmail },
            data: {
              role: 'PROJECT_MANAGER',
              name: userData.name,
              password: hashedPassword,
            },
          });
          
          console.log(`✅ User updated: ${userData.name} (${normalizedEmail})`);
          console.log(`   Role: ${updatedUser.role}\n`);
        } else {
          // Create project manager user
          const user = await prisma.user.create({
            data: {
              email: normalizedEmail,
              password: hashedPassword,
              name: userData.name,
              role: 'PROJECT_MANAGER',
              emailVerified: new Date(),
            },
          });

          console.log(`✅ Project manager user created: ${userData.name}`);
          console.log(`   📧 Email: ${normalizedEmail}`);
          console.log(`   🔑 Password: ${password}`);
          console.log(`   👤 Role: ${user.role}\n`);
        }
      } catch (error) {
        console.error(`❌ Error processing user ${userData.name} (${normalizedEmail}):`, error);
      }
    }

    console.log('✨ All project manager users processed!');
    console.log(`⚠️  All users have password: ${password}`);
    console.log('⚠️  Please change passwords after first login!');
  } catch (error) {
    console.error('❌ Error creating project manager users:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createProjectManagers();

