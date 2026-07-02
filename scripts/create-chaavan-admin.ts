/**
 * Create or update the local admin/developer account from .env.
 * Run with: npx tsx scripts/create-chaavan-admin.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function createDeveloperAccount() {
  const email = (process.env.ADMIN_EMAIL || 'surechaavanchidroop@gmail.com').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'test1234';
  const name = process.env.ADMIN_NAME || 'Chaavan';

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      const updatedUser = await prisma.user.update({
        where: { email },
        data: {
          role: 'DEVELOPER',
          isDeveloper: true,
          isSuperAdmin: false,
          name,
          password: hashedPassword,
          emailVerified: new Date(),
          deactivatedAt: null,
        },
      });

      console.log('✅ Developer account updated');
      console.log({
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
        isDeveloper: updatedUser.isDeveloper,
      });
      return;
    }

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: 'DEVELOPER',
        isDeveloper: true,
        isSuperAdmin: false,
        emailVerified: new Date(),
      },
    });

    console.log('✅ Developer account created');
    console.log({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isDeveloper: user.isDeveloper,
    });
    console.log(`Sign in at ${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/login`);
  } catch (error) {
    console.error('❌ Error creating developer account:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

createDeveloperAccount();
