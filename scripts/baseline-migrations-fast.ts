/**
 * Fast one-shot Prisma migration baseline for databases created with db push.
 * Inserts all migration records into _prisma_migrations in a single transaction
 * instead of running `prisma migrate resolve` per migration (~100x faster).
 *
 * Usage:
 *   BASELINE_CONFIRM=1 DATABASE_URL="postgresql://..." npx tsx scripts/baseline-migrations-fast.ts
 *
 * Neon: prefer the direct (non-pooler) host for migrations — this script
 * auto-rewrites *-pooler.* to the direct endpoint when possible.
 */
import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import postgres from "postgres";

const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "prisma", "migrations");

function preferDirectDatabaseUrl(url: string): string {
  if (url.includes("-pooler.")) {
    const direct = url.replace("-pooler.", ".");
    console.log("Using direct Neon URL for migration locking (non-pooler).");
    return direct;
  }
  return url;
}

function migrationChecksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

function listMigrations(): Array<{ name: string; checksum: string }> {
  const names = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  return names
    .map((name) => {
      const sqlPath = path.join(MIGRATIONS_DIR, name, "migration.sql");
      try {
        const sql = readFileSync(sqlPath, "utf8");
        return { name, checksum: migrationChecksum(sql) };
      } catch {
        return null;
      }
    })
    .filter((row): row is { name: string; checksum: string } => row !== null);
}

async function confirmUnlessForced(): Promise<void> {
  if (process.env.BASELINE_CONFIRM === "1") return;
  const rl = createInterface({ input, output });
  console.log(
    "This inserts ALL migration names into _prisma_migrations without running SQL.",
  );
  console.log("Only use when the live schema already matches prisma/schema.prisma.");
  const answer = await rl.question("Baseline this database? [y/N] ");
  rl.close();
  if (answer.trim().toLowerCase() !== "y") {
    console.log("Aborted.");
    process.exit(1);
  }
}

async function ensureMigrationsTable(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )
  `;
}

async function main() {
  const rawUrl = process.env.DATABASE_URL?.trim();
  if (!rawUrl) {
    console.error("ERROR: DATABASE_URL is required.");
    process.exit(1);
  }

  await confirmUnlessForced();

  const databaseUrl = preferDirectDatabaseUrl(rawUrl);
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 30 });

  try {
    const migrations = listMigrations();
    if (migrations.length === 0) {
      console.error("No migrations found in prisma/migrations/");
      process.exit(1);
    }

    await ensureMigrationsTable(sql);

    const existingRows = await sql<{ migration_name: string }[]>`
      SELECT migration_name FROM "_prisma_migrations"
    `;
    const existing = new Set(existingRows.map((row) => row.migration_name));

    const pending = migrations.filter((m) => !existing.has(m.name));
    const already = migrations.length - pending.length;

    if (pending.length === 0) {
      console.log(`All ${migrations.length} migration(s) already baselined. Nothing to do.`);
      return;
    }

    console.log(
      `Baselining ${pending.length} migration(s) (${already} already recorded)...`,
    );

    const now = new Date();
    await sql.begin(async (tx) => {
      for (const migration of pending) {
        await tx`
          INSERT INTO "_prisma_migrations" (
            id,
            checksum,
            finished_at,
            migration_name,
            logs,
            rolled_back_at,
            started_at,
            applied_steps_count
          ) VALUES (
            ${randomUUID()},
            ${migration.checksum},
            ${now},
            ${migration.name},
            NULL,
            NULL,
            ${now},
            1
          )
        `;
      }
    });

    console.log(`Done. Inserted ${pending.length} migration record(s).`);
    console.log("Verify with: npx prisma migrate deploy");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
