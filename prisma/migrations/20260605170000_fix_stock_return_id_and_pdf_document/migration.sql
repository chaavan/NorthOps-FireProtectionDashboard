-- Align legacy stock_return_id column with Prisma's job_stock_return_id mapping.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'job_stock_return_lines'
      AND column_name = 'stock_return_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'job_stock_return_lines'
      AND column_name = 'job_stock_return_id'
  ) THEN
    ALTER TABLE "job_stock_return_lines"
      RENAME COLUMN "stock_return_id" TO "job_stock_return_id";
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'job_stock_return_lines'
      AND column_name = 'stock_return_id'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'job_stock_return_lines'
      AND column_name = 'job_stock_return_id'
  ) THEN
    UPDATE "job_stock_return_lines"
    SET "job_stock_return_id" = COALESCE("job_stock_return_id", "stock_return_id")
    WHERE "job_stock_return_id" IS NULL
      AND "stock_return_id" IS NOT NULL;

    ALTER TABLE "job_stock_return_lines" DROP COLUMN "stock_return_id";
  END IF;
END $$;

DELETE FROM "job_stock_return_lines"
WHERE "job_stock_return_id" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'job_stock_return_lines'
      AND column_name = 'job_stock_return_id'
  ) THEN
    ALTER TABLE "job_stock_return_lines"
      ALTER COLUMN "job_stock_return_id" SET NOT NULL;
  END IF;
END $$;

ALTER TABLE "job_stock_returns"
  ADD COLUMN IF NOT EXISTS "pdf_document" JSONB;
