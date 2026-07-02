/**
 * Script to create sales users
 * Run with: npx ts-node scripts/create-sales.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const salesMembers = [
  { name: 'Jason Bowman', email: 'jbowman@totalfire.biz' },
  { name: 'Chris Anthony', email: 'canthony@totalfire.biz' },
  { name: 'Kevin Siegel', email: 'ksiegel@totalfire.biz' },
  { name: 'Jerrod Glover', email: 'jglover@totalfire.biz' },
  { name: 'Chris Korth', email: 'ckorth@totalfire.biz' },
  { name: 'Ryan Goossens', email: 'rgoossens@totalfire.biz' },
  { name: 'Jon Goossens', email: 'jgoossens@totalfire.biz' },
  { name: 'Marc Heuser', email: 'mheuser@totalfire.biz' },
  { name: 'Bob Brown', email: 'rbrown@totalfire.biz' },
  { name: 'Chris Falatic', email: 'cfalatic@totalfire.biz' },
];

const password = 'test1234';

async function createSalesMembers() {
  try {
    // Hash password once for all users
    const hashedPassword = await bcrypt.hash(password, 10);

    console.log('🔐 Creating sales member users...\n');

    for (const userData of salesMembers) {
      const normalizedEmail = userData.email.trim().toLowerCase();
      
      try {
        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
          where: { email: normalizedEmail },
        });

        if (existingUser) {
          console.log(`⚠️  User with email ${normalizedEmail} already exists`);
          console.log(`   Current role: ${existingUser.role}`);
          console.log('   Updating role to SALES and password...');
          
          const updatedUser = await prisma.user.update({
            where: { email: normalizedEmail },
            data: {
              role: 'SALES',
              name: userData.name,
              password: hashedPassword,
            },
          });
          
          console.log(`✅ User updated: ${userData.name} (${normalizedEmail})`);
          console.log(`   Role: ${updatedUser.role}\n`);
        } else {
          // Create sales user
          const user = await prisma.user.create({
            data: {
              email: normalizedEmail,
              password: hashedPassword,
              name: userData.name,
              role: 'SALES',
              emailVerified: new Date(),
            },
          });

          console.log(`✅ Sales member user created: ${userData.name}`);
          console.log(`   📧 Email: ${normalizedEmail}`);
          console.log(`   🔑 Password: ${password}`);
          console.log(`   👤 Role: ${user.role}\n`);
        }
      } catch (error) {
        console.error(`❌ Error processing user ${userData.name} (${normalizedEmail}):`, error);
      }
    }

    console.log('✨ All sales member users processed!');
    console.log(`⚠️  All users have password: ${password}`);
    console.log('⚠️  Please change passwords after first login!');
  } catch (error) {
    console.error('❌ Error creating sales member users:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createSalesMembers();

