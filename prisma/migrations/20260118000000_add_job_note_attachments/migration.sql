-- CreateTable
CREATE TABLE IF NOT EXISTS "job_note_attachments" (
    "id" TEXT NOT NULL,
    "note_id" TEXT NOT NULL,
    "job_number" TEXT NOT NULL,
    "r2_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_note_attachments_pkey" PRIMARY KEY ("id")
);

-- Foreign key to job_notes
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'job_notes'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'job_note_attachments_note_id_fkey'
  ) THEN
    ALTER TABLE "job_note_attachments"
    ADD CONSTRAINT "job_note_attachments_note_id_fkey"
    FOREIGN KEY ("note_id") REFERENCES "job_notes"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;

-- Unique constraint on r2_key (via unique index)
CREATE UNIQUE INDEX IF NOT EXISTS "job_note_attachments_r2_key_key" ON "job_note_attachments"("r2_key");

-- Indexes
CREATE INDEX IF NOT EXISTS "job_note_attachments_note_id_idx" ON "job_note_attachments"("note_id");
CREATE INDEX IF NOT EXISTS "job_note_attachments_job_number_idx" ON "job_note_attachments"("job_number");
CREATE INDEX IF NOT EXISTS "job_note_attachments_created_at_idx" ON "job_note_attachments"("created_at");
