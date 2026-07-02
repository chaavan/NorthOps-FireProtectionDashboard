import { prisma } from "../lib/prisma";

/**
 * Clears inventory_movements.actor_user_id values that do not reference User.id
 * (e.g. legacy "system" or email strings) so the actor FK can be applied.
 */
async function main() {
  const orphaned = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM inventory_movements im
    WHERE im.actor_user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "User" u WHERE u.id = im.actor_user_id
      )
  `;
  const orphanCount = Number(orphaned[0]?.count ?? 0);
  console.log(`Orphaned inventory_movements.actor_user_id rows: ${orphanCount}`);

  await prisma.$executeRaw`
    ALTER TABLE inventory_movements
    ALTER COLUMN actor_user_id DROP NOT NULL
  `;
  console.log("inventory_movements.actor_user_id is nullable.");

  if (orphanCount > 0) {
    const cleared = await prisma.$executeRaw`
      UPDATE inventory_movements im
      SET actor_user_id = NULL
      WHERE im.actor_user_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "User" u WHERE u.id = im.actor_user_id
        )
    `;
    console.log(`Cleared ${cleared} orphaned actor_user_id value(s).`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Failed to repair inventory movement actors:", err);
  await prisma.$disconnect();
  process.exit(1);
});
