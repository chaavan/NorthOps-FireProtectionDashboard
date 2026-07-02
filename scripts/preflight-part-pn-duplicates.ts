import { prisma } from "../lib/prisma";
import { normalizePartNumber } from "../lib/inventoryQuantity";

async function main() {
  const parts = await prisma.part.findMany({
    select: {
      id: true,
      pn: true,
      vendor: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  const grouped = new Map<
    string,
    Array<{ id: string; pn: string; vendor: string | null; updatedAt: Date }>
  >();

  for (const part of parts) {
    const key = normalizePartNumber(part.pn);
    if (!key) continue;
    const rows = grouped.get(key) ?? [];
    rows.push(part);
    grouped.set(key, rows);
  }

  const duplicates = Array.from(grouped.entries()).filter(
    ([, rows]) => rows.length > 1,
  );

  if (duplicates.length === 0) {
    console.log("No normalized PN duplicates found. Schema hardening is safe to proceed.");
    await prisma.$disconnect();
    return;
  }

  console.error(
    `Found ${duplicates.length} normalized PN duplicate group(s). Resolve before adding unique constraints.`,
  );
  for (const [normalizedPn, rows] of duplicates.slice(0, 200)) {
    console.error(`\nPN key: ${normalizedPn}`);
    for (const row of rows) {
      console.error(
        `  - id=${row.id} pn="${row.pn}" vendor="${row.vendor ?? ""}" updatedAt=${row.updatedAt.toISOString()}`,
      );
    }
  }

  await prisma.$disconnect();
  process.exit(1);
}

main().catch(async (err) => {
  console.error("Failed PN duplicate preflight:", err);
  await prisma.$disconnect();
  process.exit(1);
});
