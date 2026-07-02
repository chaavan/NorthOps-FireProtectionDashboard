-- Legacy migration retained for history compatibility.
-- Make all operations conditional so this migration is safe on a fresh shadow DB
-- where "jobs" may not exist at this point in the current migration chain.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'jobs'
  ) THEN
    ALTER TABLE IF EXISTS "jobs" ADD COLUMN IF NOT EXISTS "ship_date" TIMESTAMP(3);
    ALTER TABLE IF EXISTS "jobs" ADD COLUMN IF NOT EXISTS "delivery_date" TIMESTAMP(3);

    UPDATE "jobs"
    SET "ship_date" = COALESCE("stocklist_delivery_ship_date", CURRENT_TIMESTAMP)
    WHERE "ship_date" IS NULL;

    UPDATE "jobs"
    SET "delivery_date" = COALESCE("stocklist_delivery_ship_date", CURRENT_TIMESTAMP)
    WHERE "delivery_date" IS NULL;

    ALTER TABLE IF EXISTS "jobs" ALTER COLUMN "ship_date" SET NOT NULL;
    ALTER TABLE IF EXISTS "jobs" ALTER COLUMN "delivery_date" SET NOT NULL;

    CREATE INDEX IF NOT EXISTS "jobs_ship_date_idx" ON "jobs"("ship_date");
    CREATE INDEX IF NOT EXISTS "jobs_delivery_date_idx" ON "jobs"("delivery_date");
  END IF;
END
$$;
