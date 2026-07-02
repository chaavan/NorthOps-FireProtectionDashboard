/**
 * Script to create admin users
 * Run with: npx ts-node scripts/create-admin-users.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const adminUsers = [
  { name: 'Clare Wise', email: 'cwise@totalfire.biz' },
  { name: 'Courtney Toliver', email: 'ctoliver@totalfire.biz' },
  { name: 'Tommy Russo', email: 'trusso@totalfire.biz' },
  { name: 'Mike Wilcox', email: 'Mwilcox@totalfire.biz' },
  { name: 'Cisco Hernandez', email: 'cherandez@totalfire.biz' },
];

const password = 'test1234';

async function createAdminUsers() {
  try {
    // Hash password once for all users
    const hashedPassword = await bcrypt.hash(password, 10);

    console.log('🔐 Creating admin users...\n');

    for (const userData of adminUsers) {
      const normalizedEmail = userData.email.trim().toLowerCase();
      
      try {
        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
          where: { email: normalizedEmail },
        });

        if (existingUser) {
          console.log(`⚠️  User with email ${normalizedEmail} already exists`);
          console.log('   Updating role to ADMIN and password...');
          
          const updatedUser = await prisma.user.update({
            where: { email: normalizedEmail },
            data: {
              role: 'ADMIN',
              name: userData.name,
              password: hashedPassword,
            },
          });
          
          console.log(`✅ User updated: ${userData.name} (${normalizedEmail})`);
          console.log(`   Role: ${updatedUser.role}\n`);
        } else {
          // Create admin user
          const user = await prisma.user.create({
            data: {
              email: normalizedEmail,
              password: hashedPassword,
              name: userData.name,
              role: 'ADMIN',
              emailVerified: new Date(),
            },
          });

          console.log(`✅ Admin user created: ${userData.name}`);
          console.log(`   📧 Email: ${normalizedEmail}`);
          console.log(`   🔑 Password: ${password}`);
          console.log(`   👤 Role: ${user.role}\n`);
        }
      } catch (error) {
        console.error(`❌ Error processing user ${userData.name} (${normalizedEmail}):`, error);
      }
    }

    console.log('✨ All admin users processed!');
    console.log(`⚠️  All users have password: ${password}`);
    console.log('⚠️  Please change passwords after first login!');
  } catch (error) {
    console.error('❌ Error creating admin users:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createAdminUsers();

