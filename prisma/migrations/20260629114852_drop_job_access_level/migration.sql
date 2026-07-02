-- Drop the legacy coarse per-job access_level now that equivalent
-- JobPermissionOverride rows have been backfilled for every existing
-- job_access row (see scripts/migrate-job-access-levels-to-overrides.ts).

DROP INDEX IF EXISTS "job_access_access_level_idx";

ALTER TABLE "job_access" DROP COLUMN IF EXISTS "access_level";

DROP TYPE IF EXISTS "JobAccessLevel";
