-- Persist autosaved import-workspace state separately from parser-owned review snapshots.
ALTER TABLE "job_imports"
ADD COLUMN "draft_state" JSONB;

CREATE TABLE "job_import_draft_attachments" (
    "id" TEXT NOT NULL,
    "job_import_id" TEXT NOT NULL,
    "r2_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "file_name" TEXT,
    "uploaded_by_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_import_draft_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "job_import_draft_attachments_r2_key_key"
ON "job_import_draft_attachments"("r2_key");

CREATE INDEX "job_import_draft_attachments_job_import_id_idx"
ON "job_import_draft_attachments"("job_import_id");

CREATE INDEX "job_import_draft_attachments_created_at_idx"
ON "job_import_draft_attachments"("created_at");

ALTER TABLE "job_import_draft_attachments"
ADD CONSTRAINT "job_import_draft_attachments_job_import_id_fkey"
FOREIGN KEY ("job_import_id") REFERENCES "job_imports"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
