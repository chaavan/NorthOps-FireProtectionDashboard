-- CreateEnum
CREATE TYPE "JobStockReturnStatus" AS ENUM ('ACTIVE', 'REVERSED', 'DELETED');

-- AlterTable
ALTER TABLE "job_stock_returns"
  ADD COLUMN "status" "JobStockReturnStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "reversed_at" TIMESTAMP(3),
  ADD COLUMN "reversed_by_user_id" TEXT,
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "deleted_by_user_id" TEXT,
  ADD COLUMN "delete_reason" TEXT;

-- CreateIndex
CREATE INDEX "job_stock_returns_job_number_status_idx" ON "job_stock_returns"("job_number", "status");

-- AddForeignKey
ALTER TABLE "job_stock_returns"
  ADD CONSTRAINT "job_stock_returns_reversed_by_user_id_fkey"
  FOREIGN KEY ("reversed_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_stock_returns"
  ADD CONSTRAINT "job_stock_returns_deleted_by_user_id_fkey"
  FOREIGN KEY ("deleted_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
