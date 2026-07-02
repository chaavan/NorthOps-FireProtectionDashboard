-- Multi-variant support: add variantKey to Estimate and EstimateRevision

ALTER TABLE "estimates"
  ADD COLUMN "variant_key" TEXT NOT NULL DEFAULT 'base',
  ADD COLUMN "variant_label" TEXT,
  ADD COLUMN "variant_status" TEXT NOT NULL DEFAULT 'draft';

ALTER TABLE "estimate_revisions"
  ADD COLUMN "variant_key" TEXT NOT NULL DEFAULT 'base';

-- Back-fill existing rows to 'base' (handled by DEFAULT, but explicit for clarity)
UPDATE "estimates" SET "variant_key" = 'base' WHERE "variant_key" IS NULL OR "variant_key" = '';
UPDATE "estimate_revisions" SET "variant_key" = 'base' WHERE "variant_key" IS NULL OR "variant_key" = '';

-- Drop the old uniqueness constraint (jobNumber, listNumber, templateKey)
ALTER TABLE "estimates" DROP CONSTRAINT IF EXISTS "estimates_job_number_list_number_template_key_key";

-- Add the new uniqueness constraint including variantKey
CREATE UNIQUE INDEX "estimates_job_number_list_number_template_key_variant_key_key"
  ON "estimates" ("job_number", "list_number", "template_key", "variant_key");

-- Supporting indexes for variant lookups
CREATE INDEX "estimates_job_number_list_number_template_key_variant_key_idx"
  ON "estimates" ("job_number", "list_number", "template_key", "variant_key");

CREATE INDEX "estimate_revisions_job_number_list_number_template_key_variant_key_created_at_idx"
  ON "estimate_revisions" ("job_number", "list_number", "template_key", "variant_key", "created_at");
