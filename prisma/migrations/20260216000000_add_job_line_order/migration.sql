-- AlterTable
ALTER TABLE "jobs"
ADD COLUMN "line_order" INTEGER;

-- CreateIndex
CREATE INDEX "jobs_job_number_list_number_line_order_idx" ON "jobs"("job_number", "list_number", "line_order");
