DO $$ BEGIN
  CREATE TYPE "JobImportMode" AS ENUM ('NEW_JOB_IMPORT', 'EXISTING_JOB_UPDATE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "job_imports"
ADD COLUMN IF NOT EXISTS "mode" "JobImportMode" NOT NULL DEFAULT 'NEW_JOB_IMPORT',
ADD COLUMN IF NOT EXISTS "target_job_number" text,
ADD COLUMN IF NOT EXISTS "target_list_number" text,
ADD COLUMN IF NOT EXISTS "target_job_name" text;

CREATE INDEX IF NOT EXISTS "job_imports_mode_target_job_number_target_list_number_created_at_idx"
ON "job_imports"("mode", "target_job_number", "target_list_number", "created_at");
