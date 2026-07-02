-- Legacy databases may have job_number on return lines without Prisma knowing about it.
ALTER TABLE "job_stock_return_lines"
  ADD COLUMN IF NOT EXISTS "job_number" TEXT;

UPDATE "job_stock_return_lines" jsrl
SET "job_number" = jsr."job_number"
FROM "job_stock_returns" jsr
WHERE jsrl."job_stock_return_id" = jsr."id"
  AND (jsrl."job_number" IS NULL OR BTRIM(jsrl."job_number") = '');

DELETE FROM "job_stock_return_lines"
WHERE "job_number" IS NULL OR BTRIM("job_number") = '';

ALTER TABLE "job_stock_return_lines"
  ALTER COLUMN "job_number" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "job_stock_return_lines_job_number_idx"
  ON "job_stock_return_lines"("job_number");
