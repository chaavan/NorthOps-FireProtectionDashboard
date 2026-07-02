-- Set deliveryDate to today for all jobs that don't have a delivery date
-- This script updates the delivery_date column in the jobs table

-- Update all jobs to set delivery_date to today (midnight) if it's null
-- Note: After the migration, delivery_date should be NOT NULL, but this handles edge cases
UPDATE "jobs"
SET "delivery_date" = DATE_TRUNC('day', CURRENT_TIMESTAMP)
WHERE "delivery_date" IS NULL;

-- Also update jobs that might have been set to a default future timestamp
-- Set them to today's date (just the date part, at midnight)
UPDATE "jobs"
SET "delivery_date" = DATE_TRUNC('day', CURRENT_TIMESTAMP)
WHERE "delivery_date" > CURRENT_TIMESTAMP + INTERVAL '10 years';

-- Show summary
SELECT 
  COUNT(*) as total_jobs,
  COUNT(CASE WHEN "delivery_date"::date = CURRENT_DATE THEN 1 END) as jobs_with_today_delivery_date,
  MIN("delivery_date"::date) as earliest_delivery_date,
  MAX("delivery_date"::date) as latest_delivery_date
FROM "jobs";
