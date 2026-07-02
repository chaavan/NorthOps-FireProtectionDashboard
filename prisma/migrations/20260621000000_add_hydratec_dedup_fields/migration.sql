-- AlterTable
ALTER TABLE "job_imports"
  ADD COLUMN "parsed_job_number" TEXT,
  ADD COLUMN "parsed_list_number" TEXT,
  ADD COLUMN "parsed_stocklist_date" TEXT;

-- CreateIndex
CREATE INDEX "job_imports_parsed_job_number_parsed_list_number_parsed_st_idx" ON "job_imports"("parsed_job_number", "parsed_list_number", "parsed_stocklist_date");
