-- AlterTable
ALTER TABLE "job_imports"
  ADD COLUMN "source_format" TEXT NOT NULL DEFAULT 'pdf',
  ADD COLUMN "source_external_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "job_imports_source_external_id_key" ON "job_imports"("source_external_id");

-- CreateTable
CREATE TABLE "hydratec_import_cursors" (
  "id" TEXT NOT NULL,
  "delta_token" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hydratec_import_cursors_pkey" PRIMARY KEY ("id")
);
