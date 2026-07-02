-- AlterTable
ALTER TABLE IF EXISTS "job_notes" ADD COLUMN IF NOT EXISTS "parent_id" TEXT;

-- CreateIndex
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'job_notes'
  ) THEN
    CREATE INDEX IF NOT EXISTS "job_notes_parent_id_idx" ON "job_notes"("parent_id");
  END IF;
END
$$;

-- AddForeignKey
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
    WHERE conname = 'job_notes_parent_id_fkey'
  ) THEN
    ALTER TABLE "job_notes"
      ADD CONSTRAINT "job_notes_parent_id_fkey"
      FOREIGN KEY ("parent_id") REFERENCES "job_notes"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
