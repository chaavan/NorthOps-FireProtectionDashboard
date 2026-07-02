import "dotenv/config";
import { prisma } from "../lib/prisma";
import { buildMaterialCatalogRowMetadata } from "../lib/estimate/system1Template";

function demoPriceForKey(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  const min = 2.5;
  const max = 149.99;
  const ratio = (hash % 10_000) / 10_000;
  return Math.round((min + ratio * (max - min)) * 100) / 100;
}

async function main() {
  if (process.env.MATERIAL_CATALOG_DEMO_PRICES_CONFIRM !== "I_UNDERSTAND") {
    throw new Error(
      "Refusing to run: set MATERIAL_CATALOG_DEMO_PRICES_CONFIRM=I_UNDERSTAND",
    );
  }

  const actorEmail =
    process.env.MATERIAL_CATALOG_DEMO_PRICES_ACTOR?.trim() || "demo-seed@northops.local";

  const baseRows = buildMaterialCatalogRowMetadata();
  const pricedRows = baseRows.filter(
    (row) => row.rowType === "item" && row.unitCostCell && !row.formulaKey,
  );

  console.log(`Applying demo prices to ${pricedRows.length} catalog items...`);

  let updated = 0;
  const batchSize = 50;

  for (let i = 0; i < pricedRows.length; i += batchSize) {
    const batch = pricedRows.slice(i, i + batchSize);
    await prisma.$transaction(async (tx) => {
      for (const row of batch) {
        const defaultUnitCost = demoPriceForKey(row.rowKey);
        const data = JSON.stringify({ defaultUnitCost });

        await tx.$executeRaw`
          INSERT INTO system1_material_catalog_overrides (
            row_key,
            data,
            created_by,
            updated_by,
            created_at,
            updated_at
          )
          VALUES (
            ${row.rowKey},
            ${data}::jsonb,
            ${actorEmail},
            ${actorEmail},
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
          ON CONFLICT (row_key) DO UPDATE SET
            data = system1_material_catalog_overrides.data || EXCLUDED.data,
            updated_by = EXCLUDED.updated_by,
            updated_at = CURRENT_TIMESTAMP
        `;

        updated++;
      }
    });

    if (updated % 200 === 0 || updated === pricedRows.length) {
      console.log(`  Updated ${updated}/${pricedRows.length}...`);
    }
  }

  console.log(`\nDone. Applied demo prices to ${updated} catalog rows.`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
