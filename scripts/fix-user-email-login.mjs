import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const targetEmail = (process.argv[2] || 'test@gmail.com').trim().toLowerCase();
const newPassword = process.argv.includes('--password')
  ? process.argv[process.argv.indexOf('--password') + 1]
  : null;

const user = await prisma.user.findFirst({
  where: { email: { equals: targetEmail, mode: 'insensitive' } },
});

if (!user) {
  console.log('No user found for', targetEmail);
  const recent = await prisma.user.findMany({
    select: { email: true, role: true, name: true },
    orderBy: { createdAt: 'desc' },
    take: 15,
  });
  console.log('Recent users:', recent);
  await prisma.$disconnect();
  process.exit(1);
}

const data = { email: targetEmail };
if (newPassword) {
  data.password = await bcrypt.hash(newPassword, 10);
}

await prisma.user.update({ where: { id: user.id }, data });
console.log('OK:', { id: user.id, email: targetEmail, passwordReset: !!newPassword, was: user.email });
await prisma.$disconnect();
