UPDATE "standalone_estimate_variants"
SET "data" = "data" - 'masterOverrides'
WHERE "data" ? 'masterOverrides';

DROP TABLE IF EXISTS "estimate_global_overrides";
