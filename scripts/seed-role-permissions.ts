import { PrismaClient } from "@prisma/client";
import { ROLE_TEMPLATE_SEED } from "../lib/permissionCatalog";

const prisma = new PrismaClient();

async function main() {
  for (const entry of ROLE_TEMPLATE_SEED) {
    await prisma.rolePermissionTemplate.upsert({
      where: {
        role_permissionKey: {
          role: entry.role,
          permissionKey: entry.permissionKey,
        },
      },
      update: {
        effect: entry.effect as any,
      },
      create: {
        role: entry.role,
        permissionKey: entry.permissionKey,
        effect: entry.effect as any,
      },
    });
  }

  console.log(`Seeded ${ROLE_TEMPLATE_SEED.length} role permission templates.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
