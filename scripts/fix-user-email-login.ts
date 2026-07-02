/**
 * Normalize a user's email for login + optionally set password.
 * Usage:
 *   npx tsx scripts/fix-user-email-login.ts test@gmail.com
 *   npx tsx scripts/fix-user-email-login.ts test@gmail.com --password "YourNewPassword"
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const passwordFlagIndex = args.indexOf('--password');
  const newPassword =
    passwordFlagIndex >= 0 ? args[passwordFlagIndex + 1] : process.env.USER_PASSWORD;
  const emailArg = args.find((arg) => !arg.startsWith('--') && arg !== newPassword);
  const targetEmail = (emailArg || 'test@gmail.com').trim().toLowerCase();

  const variants = [
    targetEmail,
    targetEmail.charAt(0).toUpperCase() + targetEmail.slice(1),
    targetEmail.replace(/^./, (c) => c.toUpperCase()),
  ];

  let user =
    (await prisma.user.findUnique({ where: { email: targetEmail } })) ||
    (await prisma.user.findFirst({
      where: {
        email: { equals: targetEmail, mode: 'insensitive' },
      },
    }));

  if (!user) {
    for (const variant of variants) {
      user = await prisma.user.findUnique({ where: { email: variant } });
      if (user) break;
    }
  }

  if (!user) {
    console.log(`No user found matching ${targetEmail} (tried case variants).`);
    const all = await prisma.user.findMany({
      select: { email: true, name: true, role: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    console.log('\nRecent users:');
    for (const row of all) {
      console.log(`  - ${row.email} (${row.role}) ${row.name || ''}`);
    }
    return;
  }

  const updateData: { email: string; password?: string } = { email: targetEmail };
  if (newPassword) {
    updateData.password = await bcrypt.hash(newPassword, 10);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: updateData,
  });

  console.log('User updated for login:');
  console.log('  Email (use at login):', targetEmail);
  if (newPassword) {
    console.log('  Password: set to the value you provided');
  } else {
    console.log('  Password: unchanged (use your existing password)');
  }
  console.log('  Previous email in DB:', user.email);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
