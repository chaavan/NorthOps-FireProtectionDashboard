CREATE TABLE IF NOT EXISTS "system1_material_catalog_overrides" (
  "row_key" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "system1_material_catalog_overrides_pkey" PRIMARY KEY ("row_key")
);

CREATE INDEX IF NOT EXISTS "system1_material_catalog_overrides_updated_idx"
  ON "system1_material_catalog_overrides" ("updated_at");

CREATE TABLE IF NOT EXISTS "system1_material_catalog_edit_logs" (
  "id" TEXT NOT NULL,
  "row_key" TEXT NOT NULL,
  "actor_email" TEXT,
  "changed_fields" JSONB NOT NULL,
  "before_data" JSONB NOT NULL,
  "after_data" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "system1_material_catalog_edit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "system1_material_catalog_logs_row_idx"
  ON "system1_material_catalog_edit_logs" ("row_key", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "system1_material_catalog_logs_created_idx"
  ON "system1_material_catalog_edit_logs" ("created_at" DESC);
