/**
 * Read-only. Reports whether a database is safe to baseline.
 *
 * `prisma migrate resolve --applied` (what scripts/baseline-migrations.sh runs)
 * records migrations as applied WITHOUT executing their SQL. That is correct only
 * when the schema already matches prisma/schema.prisma. Baseline a database that
 * is missing the newer tables and the deploy goes green while the tables never
 * get created — the app then 500s at runtime instead of failing at build.
 *
 * Run against whichever database you are about to baseline:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/check-db-state.ts
 *
 * Writes nothing.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Tables and columns introduced by the CRM + inventory-levels migrations. */
const REQUIRED_TABLES = [
  "crm_accounts",
  "crm_account_locations",
  "crm_contacts",
  "crm_inspections",
  "crm_deficiencies",
  "crm_opportunities",
  "crm_estimate_deficiencies",
  "crm_renewals",
  "crm_activities",
  "crm_tasks",
  "crm_tags",
  "crm_entity_tags",
  "crm_attachments",
  "vendor_lead_time_samples",
];

const REQUIRED_COLUMNS: Array<[string, string]> = [
  ["parts", "price_updated_at"],
  ["parts", "do_not_stock"],
  ["parts", "reorder_snoozed_at"],
  ["vendors", "avg_lead_time_days"],
  ["vendors", "lead_time_sample_count"],
  ["vendors", "lead_time_updated_at"],
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required.");
  // Show the host only — never print credentials.
  const host = (() => {
    try {
      const u = new URL(url);
      return `${u.hostname}${u.pathname}`;
    } catch {
      return "(unparseable)";
    }
  })();
  console.log(`database: ${host}\n`);

  const tableRows: Array<{ tablename: string }> = await prisma.$queryRawUnsafe(
    "SELECT tablename FROM pg_tables WHERE schemaname='public'",
  );
  const tables = new Set(tableRows.map((r) => r.tablename));
  console.log(`tables in public schema: ${tables.size}`);

  const migRows: Array<{ t: string | null }> = await prisma.$queryRawUnsafe(
    "SELECT to_regclass('public._prisma_migrations')::text AS t",
  );
  const hasHistory = migRows[0]?.t !== null;
  let applied = 0;
  if (hasHistory) {
    const c: Array<{ c: number }> = await prisma.$queryRawUnsafe(
      "SELECT count(*)::int AS c FROM public._prisma_migrations WHERE finished_at IS NOT NULL",
    );
    applied = c[0].c;
  }
  console.log(`_prisma_migrations: ${hasHistory ? `present (${applied} applied)` : "ABSENT"}`);

  const missingTables = REQUIRED_TABLES.filter((t) => !tables.has(t));

  const colRows: Array<{ table_name: string; column_name: string }> =
    await prisma.$queryRawUnsafe(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name IN ('parts','vendors')`,
    );
  const cols = new Set(colRows.map((r) => `${r.table_name}.${r.column_name}`));
  const missingColumns = REQUIRED_COLUMNS.filter(([t, c]) => !cols.has(`${t}.${c}`));

  console.log(
    `\nnew tables present:  ${REQUIRED_TABLES.length - missingTables.length}/${REQUIRED_TABLES.length}`,
  );
  if (missingTables.length) console.log(`  missing: ${missingTables.join(", ")}`);
  console.log(
    `new columns present: ${REQUIRED_COLUMNS.length - missingColumns.length}/${REQUIRED_COLUMNS.length}`,
  );
  if (missingColumns.length) {
    console.log(`  missing: ${missingColumns.map(([t, c]) => `${t}.${c}`).join(", ")}`);
  }

  // How much is actually at stake if the schema has to change.
  const counts: Record<string, number> = {};
  for (const t of ["parts", "jobs", "deliveries", "purchase_orders"]) {
    if (!tables.has(t)) continue;
    const r: Array<{ c: number }> = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS c FROM public."${t}"`,
    );
    counts[t] = r[0].c;
  }
  const withData = Object.entries(counts).filter(([, c]) => c > 0);
  console.log(
    `\nrow counts: ${Object.entries(counts).map(([t, c]) => `${t}=${c}`).join("  ") || "(none)"}`,
  );

  const schemaMatches = missingTables.length === 0 && missingColumns.length === 0;
  console.log("\n" + "=".repeat(64));
  if (hasHistory && applied > 0) {
    console.log("VERDICT: already baselined — migrate deploy should run normally.");
    console.log("If the build still fails, the error is something other than P3005.");
  } else if (schemaMatches) {
    console.log("VERDICT: SAFE TO BASELINE.");
    console.log("The schema already matches, so recording the migrations as applied");
    console.log("is accurate. Run:");
    console.log('  BASELINE_CONFIRM=1 DATABASE_URL="..." bash scripts/baseline-migrations.sh');
  } else {
    console.log("VERDICT: DO NOT BASELINE YET.");
    console.log("This database is missing tables/columns listed above. Baselining now");
    console.log("would record those migrations as applied without creating anything,");
    console.log("and the CRM and inventory pages would fail at runtime.");
    console.log("\nApply the schema first, then baseline:");
    console.log('  DATABASE_URL="..." npx prisma db push');
    console.log('  BASELINE_CONFIRM=1 DATABASE_URL="..." bash scripts/baseline-migrations.sh');
    if (withData.length) {
      console.log(
        `\nCAUTION: this database holds data (${withData
          .map(([t, c]) => `${t}=${c}`)
          .join(", ")}). Review what db push reports before accepting it:`,
      );
      console.log(
        '  DATABASE_URL="..." npx prisma migrate diff --from-url "$DATABASE_URL" \\',
      );
      console.log("    --to-schema-datamodel prisma/schema.prisma --script");
    }
  }
  console.log("=".repeat(64));
}

main()
  .catch((e) => {
    console.error("ERROR:", String(e.message).split("\n")[0]);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
