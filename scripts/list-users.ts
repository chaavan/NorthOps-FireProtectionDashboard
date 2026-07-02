import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config(); // Load .env file

const prisma = new PrismaClient();

async function listUsers() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  console.log('\n📋 All Users in Database:\n');
  console.log('─'.repeat(80));
  
  users.forEach((user, index) => {
    const roleEmoji = user.role === 'ADMIN' ? '🔴' : user.role === 'PROJECT_MANAGER' ? '🔵' : user.role === 'DESIGNER' ? '🟣' : user.role === 'SALES' ? '🟢' : '⚪';
    console.log(`${index + 1}. ${user.name || 'No name'}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Role:  ${roleEmoji} ${user.role}`);
    console.log(`   Created: ${user.createdAt.toLocaleDateString()}`);
    console.log('─'.repeat(80));
  });

  console.log(`\nTotal: ${users.length} user(s)\n`);
}

listUsers()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

