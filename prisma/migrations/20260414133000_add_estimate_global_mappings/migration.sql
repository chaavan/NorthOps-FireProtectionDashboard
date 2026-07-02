CREATE TABLE IF NOT EXISTS "estimate_global_mappings" (
    "id" TEXT NOT NULL,
    "template_key" TEXT NOT NULL DEFAULT 'system-1',
    "part_number_raw" TEXT NOT NULL,
    "part_number_normalized" TEXT NOT NULL,
    "workbook_row_key" TEXT NOT NULL,
    "workbook_quantity_cell" TEXT,
    "workbook_unit_cost_cell" TEXT,
    "workbook_row_label" TEXT,
    "workbook_section" TEXT,
    "workbook_subcategory" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estimate_global_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "estimate_global_mappings_template_key_part_number_normalized_key"
ON "estimate_global_mappings"("template_key", "part_number_normalized");

CREATE INDEX IF NOT EXISTS "estimate_global_mappings_part_number_normalized_idx"
ON "estimate_global_mappings"("part_number_normalized");

CREATE INDEX IF NOT EXISTS "estimate_global_mappings_workbook_row_key_idx"
ON "estimate_global_mappings"("workbook_row_key");

CREATE INDEX IF NOT EXISTS "estimate_global_mappings_updated_at_idx"
ON "estimate_global_mappings"("updated_at");
