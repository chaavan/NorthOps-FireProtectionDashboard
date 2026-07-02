-- Add per-job/per-list/per-person permission overrides, replacing the old
-- coarse JobAccess.access_level field (dropped in a follow-up migration).

CREATE TABLE IF NOT EXISTS "job_permission_overrides" (
  "id" TEXT NOT NULL,
  "job_number" TEXT NOT NULL,
  "list_number" TEXT NOT NULL DEFAULT '1',
  "user_email" TEXT NOT NULL,
  "permission_key" TEXT NOT NULL,
  "effect" "PermissionEffect" NOT NULL,
  "changed_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "job_permission_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "job_permission_overrides_job_number_list_number_user_emai_key"
ON "job_permission_overrides"("job_number", "list_number", "user_email", "permission_key");

CREATE INDEX IF NOT EXISTS "job_permission_overrides_job_number_list_number_idx"
ON "job_permission_overrides"("job_number", "list_number");

CREATE INDEX IF NOT EXISTS "job_permission_overrides_user_email_idx"
ON "job_permission_overrides"("user_email");

ALTER TABLE "job_permission_overrides"
DROP CONSTRAINT IF EXISTS "job_permission_overrides_changed_by_user_id_fkey";

ALTER TABLE "job_permission_overrides"
ADD CONSTRAINT "job_permission_overrides_changed_by_user_id_fkey"
FOREIGN KEY ("changed_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
