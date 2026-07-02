-- DropIndex
DROP INDEX IF EXISTS "jobs_ship_date_idx";

-- AlterTable
ALTER TABLE "jobs" DROP COLUMN IF EXISTS "ship_date";
