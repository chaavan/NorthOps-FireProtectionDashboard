ALTER TABLE "job_access"
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANUAL';

CREATE INDEX "job_access_source_idx" ON "job_access"("source");
