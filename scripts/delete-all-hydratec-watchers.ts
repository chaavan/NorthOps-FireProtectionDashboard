import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.hydraTecWatcherKey.findMany({
    select: { id: true, name: true, revokedAt: true },
    orderBy: { createdAt: 'asc' },
  });

  if (rows.length === 0) {
    console.log('No HydraTec watchers found.');
    return;
  }

  console.log('Deleting all watchers:');
  for (const row of rows) {
    const status = row.revokedAt ? 'revoked' : 'active';
    console.log(`  - ${row.name} (${row.id}) [${status}]`);
  }

  const result = await prisma.hydraTecWatcherKey.deleteMany({});

  console.log(`Deleted ${result.count} watcher(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
