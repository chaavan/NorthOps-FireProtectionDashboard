-- CreateTable
CREATE TABLE "estimate_workbook_mapping_rows" (
    "id" TEXT NOT NULL,
    "template_key" TEXT NOT NULL DEFAULT 'system-1',
    "row_key" TEXT NOT NULL,
    "source_row_key" TEXT,
    "label" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "subcategory" TEXT,
    "quantity_cell" TEXT NOT NULL,
    "unit_cost_cell" TEXT NOT NULL,
    "detail" TEXT,
    "vendor_part_number" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "estimate_workbook_mapping_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "estimate_workbook_mapping_rows_template_key_idx" ON "estimate_workbook_mapping_rows"("template_key");

-- CreateIndex
CREATE UNIQUE INDEX "estimate_workbook_mapping_rows_template_key_row_key_key" ON "estimate_workbook_mapping_rows"("template_key", "row_key");

-- CreateIndex
CREATE UNIQUE INDEX "estimate_workbook_mapping_rows_template_key_source_row_key_key" ON "estimate_workbook_mapping_rows"("template_key", "source_row_key");
