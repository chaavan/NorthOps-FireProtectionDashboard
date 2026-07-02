-- AlterTable: Update list_number to have default value for existing NULL values
UPDATE "jobs" SET "list_number" = '1' WHERE "list_number" IS NULL;

-- AlterTable: Make list_number NOT NULL with default value
ALTER TABLE "jobs" ALTER COLUMN "list_number" SET NOT NULL;
ALTER TABLE "jobs" ALTER COLUMN "list_number" SET DEFAULT '1';

-- DropIndex: Drop old primary key constraint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_pkey";

-- CreateIndex: Create new composite primary key with listNumber included
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_pkey" PRIMARY KEY ("job_number", "list_number", "part_number");

-- CreateIndex: Add index for jobNumber and listNumber combination for faster lookups
CREATE INDEX "jobs_job_number_list_number_idx" ON "jobs"("job_number", "list_number");
