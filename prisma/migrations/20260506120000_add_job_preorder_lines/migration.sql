-- Job-scoped pre-order tracking (no inventory impact)
CREATE TABLE "job_preorder_lines" (
    "id" TEXT NOT NULL,
    "job_number" TEXT NOT NULL,
    "list_number" TEXT NOT NULL DEFAULT '1',
    "part_number" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL,
    "uom" TEXT,
    "vendor" TEXT,
    "notes" TEXT,
    "ordered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_preorder_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "job_preorder_lines_job_number_idx" ON "job_preorder_lines"("job_number");
CREATE INDEX "job_preorder_lines_job_number_list_number_idx" ON "job_preorder_lines"("job_number", "list_number");
CREATE INDEX "job_preorder_lines_job_number_list_number_part_number_idx" ON "job_preorder_lines"("job_number", "list_number", "part_number");
