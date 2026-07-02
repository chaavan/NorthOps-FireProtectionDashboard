CREATE TYPE "JobImportStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED', 'COMMITTED');

CREATE TABLE "job_imports" (
    "id" TEXT NOT NULL,
    "status" "JobImportStatus" NOT NULL DEFAULT 'PROCESSING',
    "source_file_name" TEXT NOT NULL,
    "source_content_type" TEXT,
    "source_file_size" INTEGER NOT NULL DEFAULT 0,
    "source_storage_mode" TEXT NOT NULL DEFAULT 'DATABASE',
    "source_storage_key" TEXT NOT NULL,
    "source_file_bytes" BYTEA,
    "raw_text" TEXT,
    "ocr_metadata" JSONB,
    "parsed_snapshot" JSONB,
    "review_snapshot" JSONB,
    "warning_summary" JSONB,
    "duplicate_snapshot" JSONB,
    "parse_version" TEXT NOT NULL DEFAULT 'job-import-v1',
    "created_by" TEXT NOT NULL,
    "committed_by" TEXT,
    "committed_at" TIMESTAMP(3),
    "committed_job_number" TEXT,
    "committed_list_number" TEXT,
    "commit_summary" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_imports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "job_imports_status_idx" ON "job_imports"("status");
CREATE INDEX "job_imports_created_by_idx" ON "job_imports"("created_by");
CREATE INDEX "job_imports_committed_job_number_committed_list_number_idx" ON "job_imports"("committed_job_number", "committed_list_number");
CREATE INDEX "job_imports_created_at_idx" ON "job_imports"("created_at");
