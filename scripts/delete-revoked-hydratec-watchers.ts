import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.hydraTecWatcherKey.findMany({
    where: { revokedAt: { not: null } },
    select: { id: true, name: true, revokedAt: true },
    orderBy: { createdAt: 'asc' },
  });

  if (rows.length === 0) {
    console.log('No revoked HydraTec watchers found.');
    return;
  }

  console.log('Deleting revoked watchers:');
  for (const row of rows) {
    console.log(`  - ${row.name} (${row.id}) revoked ${row.revokedAt?.toISOString()}`);
  }

  const result = await prisma.hydraTecWatcherKey.deleteMany({
    where: { revokedAt: { not: null } },
  });

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
