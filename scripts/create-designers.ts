/**
 * Script to create designer users
 * Run with: npx ts-node scripts/create-designers.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const designers = [
  { name: 'Matt Hanes', email: 'mhanes@totalfire.biz' },
  { name: 'Dennis Scott', email: 'dscott@totalfire.biz' },
  { name: 'Brett Weides', email: 'bweides@totalfire.biz' },
  { name: 'Brock Weston', email: 'bweston@totalfire.biz' },
  { name: 'Tom Krueger', email: 'tkrueger@totalfire.biz' },
  { name: 'Jeremy Springer', email: 'jspringer@totalfire.biz' },
  { name: 'Steve Manson', email: 'smanson@totalfire.biz' },
  { name: 'Ted Miller', email: 'tmiller@totalfire.biz' },
  { name: 'Andrew Norris', email: 'anorris@totalfire.biz' },
  { name: 'Matt Middaugh', email: 'mmiddaugh@totalfire.biz' },
  { name: 'Jim Norton', email: 'jnorton@totalfire.biz' },
  { name: 'Wes Vandenberg', email: 'wvandenberg@totalfire.biz' },
  { name: 'Nick Ford', email: 'nford@totalfire.biz' },
  { name: 'John Eash', email: 'jeash@totalfire.biz' },
  { name: 'Zack Westcott', email: 'zwestcott@totalfire.biz' },
  { name: 'Jamie Stanford', email: 'jstanford@totalfire.biz' },
  { name: 'Chris Falatic', email: 'cfalatic@totalfire.biz' },
];

const password = 'test1234';

async function createDesigners() {
  try {
    // Hash password once for all users
    const hashedPassword = await bcrypt.hash(password, 10);

    console.log('🔐 Creating designer users...\n');

    for (const userData of designers) {
      const normalizedEmail = userData.email.trim().toLowerCase();
      
      try {
        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
          where: { email: normalizedEmail },
        });

        if (existingUser) {
          console.log(`⚠️  User with email ${normalizedEmail} already exists`);
          console.log('   Updating role to DESIGNER and password...');
          
          const updatedUser = await prisma.user.update({
            where: { email: normalizedEmail },
            data: {
              role: 'DESIGNER',
              name: userData.name,
              password: hashedPassword,
            },
          });
          
          console.log(`✅ User updated: ${userData.name} (${normalizedEmail})`);
          console.log(`   Role: ${updatedUser.role}\n`);
        } else {
          // Create designer user
          const user = await prisma.user.create({
            data: {
              email: normalizedEmail,
              password: hashedPassword,
              name: userData.name,
              role: 'DESIGNER',
              emailVerified: new Date(),
            },
          });

          console.log(`✅ Designer user created: ${userData.name}`);
          console.log(`   📧 Email: ${normalizedEmail}`);
          console.log(`   🔑 Password: ${password}`);
          console.log(`   👤 Role: ${user.role}\n`);
        }
      } catch (error) {
        console.error(`❌ Error processing user ${userData.name} (${normalizedEmail}):`, error);
      }
    }

    console.log('✨ All designer users processed!');
    console.log(`⚠️  All users have password: ${password}`);
    console.log('⚠️  Please change passwords after first login!');
  } catch (error) {
    console.error('❌ Error creating designer users:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createDesigners();

