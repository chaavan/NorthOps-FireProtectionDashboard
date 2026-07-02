DROP TABLE IF EXISTS "estimate_revisions";
DROP TABLE IF EXISTS "estimates";
DROP INDEX IF EXISTS "standalone_estimate_variants_estimate_id_template_key_variant_k";

CREATE TABLE IF NOT EXISTS "standalone_estimates" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "project_name" TEXT,
    "project_number" TEXT,
    "location_line_1" TEXT,
    "location_line_2" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "standalone_estimates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "standalone_estimate_variants" (
    "id" TEXT NOT NULL,
    "estimate_id" TEXT NOT NULL,
    "template_key" TEXT NOT NULL DEFAULT 'system-1',
    "template_version" TEXT NOT NULL DEFAULT 'system-1-v1',
    "variant_key" TEXT NOT NULL DEFAULT 'base',
    "variant_label" TEXT,
    "variant_status" TEXT NOT NULL DEFAULT 'draft',
    "data" JSONB NOT NULL,
    "subtotal" DECIMAL(12,2),
    "total_cost" DECIMAL(12,2),
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "standalone_estimate_variants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "standalone_estimate_revisions" (
    "id" TEXT NOT NULL,
    "estimate_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "template_key" TEXT NOT NULL DEFAULT 'system-1',
    "template_version" TEXT NOT NULL DEFAULT 'system-1-v1',
    "variant_key" TEXT NOT NULL DEFAULT 'base',
    "label" TEXT,
    "snapshot" JSONB NOT NULL,
    "subtotal" DECIMAL(12,2),
    "total_cost" DECIMAL(12,2),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "standalone_estimate_revisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "se_estimates_archived_updated_idx"
    ON "standalone_estimates"("archived", "updated_at");
CREATE INDEX IF NOT EXISTS "se_estimates_title_idx"
    ON "standalone_estimates"("title");

CREATE UNIQUE INDEX IF NOT EXISTS "se_variants_est_tpl_variant_key"
    ON "standalone_estimate_variants"("estimate_id", "template_key", "variant_key");
CREATE INDEX IF NOT EXISTS "se_variants_estimate_id_idx"
    ON "standalone_estimate_variants"("estimate_id");
CREATE INDEX IF NOT EXISTS "se_variants_est_tpl_variant_idx"
    ON "standalone_estimate_variants"("estimate_id", "template_key", "variant_key");
CREATE INDEX IF NOT EXISTS "se_variants_updated_at_idx"
    ON "standalone_estimate_variants"("updated_at");

CREATE INDEX IF NOT EXISTS "se_revisions_estimate_created_idx"
    ON "standalone_estimate_revisions"("estimate_id", "created_at");
CREATE INDEX IF NOT EXISTS "se_revisions_variant_created_idx"
    ON "standalone_estimate_revisions"("variant_id", "created_at");
CREATE INDEX IF NOT EXISTS "se_revisions_est_tpl_variant_created_idx"
    ON "standalone_estimate_revisions"("estimate_id", "template_key", "variant_key", "created_at");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'se_variants_estimate_id_fkey'
    ) THEN
        ALTER TABLE "standalone_estimate_variants"
            ADD CONSTRAINT "se_variants_estimate_id_fkey"
            FOREIGN KEY ("estimate_id") REFERENCES "standalone_estimates"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'se_revisions_estimate_id_fkey'
    ) THEN
        ALTER TABLE "standalone_estimate_revisions"
            ADD CONSTRAINT "se_revisions_estimate_id_fkey"
            FOREIGN KEY ("estimate_id") REFERENCES "standalone_estimates"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'se_revisions_variant_id_fkey'
    ) THEN
        ALTER TABLE "standalone_estimate_revisions"
            ADD CONSTRAINT "se_revisions_variant_id_fkey"
            FOREIGN KEY ("variant_id") REFERENCES "standalone_estimate_variants"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
