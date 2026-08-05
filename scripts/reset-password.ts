/**
 * Reset admin user password
 * Run with: npx ts-node scripts/reset-password.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function resetPassword() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const newPassword = process.env.ADMIN_PASSWORD?.trim();

  if (!email || !newPassword) {
    console.log('❌ ADMIN_EMAIL and ADMIN_PASSWORD are both required.');
    return;
  }

  try {
    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      console.log(`❌ User with email ${email} not found`);
      return;
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update the password
    await prisma.user.update({
      where: { email },
      data: { password: hashedPassword },
    });

    console.log('✅ Password reset successfully!');
    console.log('📧 Email:', email);
    console.log('🔑 New Password:', newPassword);
    console.log('');
    console.log('You can now log in with these credentials.');
  } catch (error) {
    console.error('❌ Error resetting password:', error);
  } finally {
    await prisma.$disconnect();
  }
}

resetPassword();
