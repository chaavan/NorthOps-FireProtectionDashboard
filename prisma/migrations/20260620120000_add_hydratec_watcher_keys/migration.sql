-- DropIndex
DROP INDEX IF EXISTS "job_imports_source_external_id_key";

-- AlterTable
ALTER TABLE "job_imports" DROP COLUMN IF EXISTS "source_external_id";

-- DropTable
DROP TABLE IF EXISTS "hydratec_import_cursors";

-- CreateTable
CREATE TABLE "hydratec_watcher_keys" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "key_hash" TEXT NOT NULL,
  "key_prefix" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),

  CONSTRAINT "hydratec_watcher_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hydratec_watcher_keys_key_prefix_idx" ON "hydratec_watcher_keys"("key_prefix");
