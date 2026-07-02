-- Add per-user dashboard permission controls.

ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "is_super_admin" BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  CREATE TYPE "PermissionEffect" AS ENUM ('ALLOW', 'DENY');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "role_permission_templates" (
  "id" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "permission_key" TEXT NOT NULL,
  "effect" "PermissionEffect" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "role_permission_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "role_permission_templates_role_permission_key_key"
ON "role_permission_templates"("role", "permission_key");

CREATE INDEX IF NOT EXISTS "role_permission_templates_role_idx"
ON "role_permission_templates"("role");

CREATE INDEX IF NOT EXISTS "role_permission_templates_permission_key_idx"
ON "role_permission_templates"("permission_key");

CREATE TABLE IF NOT EXISTS "permission_overrides" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "permission_key" TEXT NOT NULL,
  "effect" "PermissionEffect" NOT NULL,
  "changed_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "permission_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "permission_overrides_user_id_permission_key_key"
ON "permission_overrides"("user_id", "permission_key");

CREATE INDEX IF NOT EXISTS "permission_overrides_user_id_idx"
ON "permission_overrides"("user_id");

CREATE INDEX IF NOT EXISTS "permission_overrides_permission_key_idx"
ON "permission_overrides"("permission_key");

CREATE INDEX IF NOT EXISTS "permission_overrides_changed_by_user_id_idx"
ON "permission_overrides"("changed_by_user_id");

ALTER TABLE "permission_overrides"
DROP CONSTRAINT IF EXISTS "permission_overrides_user_id_fkey";

ALTER TABLE "permission_overrides"
ADD CONSTRAINT "permission_overrides_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "permission_overrides"
DROP CONSTRAINT IF EXISTS "permission_overrides_changed_by_user_id_fkey";

ALTER TABLE "permission_overrides"
ADD CONSTRAINT "permission_overrides_changed_by_user_id_fkey"
FOREIGN KEY ("changed_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "permission_audit_logs" (
  "id" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "target_user_id" TEXT,
  "action" TEXT NOT NULL,
  "permission_key" TEXT,
  "before" JSONB,
  "after" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "permission_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "permission_audit_logs_actor_user_id_idx"
ON "permission_audit_logs"("actor_user_id");

CREATE INDEX IF NOT EXISTS "permission_audit_logs_target_user_id_idx"
ON "permission_audit_logs"("target_user_id");

CREATE INDEX IF NOT EXISTS "permission_audit_logs_permission_key_idx"
ON "permission_audit_logs"("permission_key");

CREATE INDEX IF NOT EXISTS "permission_audit_logs_created_at_idx"
ON "permission_audit_logs"("created_at");

ALTER TABLE "permission_audit_logs"
DROP CONSTRAINT IF EXISTS "permission_audit_logs_actor_user_id_fkey";

ALTER TABLE "permission_audit_logs"
ADD CONSTRAINT "permission_audit_logs_actor_user_id_fkey"
FOREIGN KEY ("actor_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "permission_audit_logs"
DROP CONSTRAINT IF EXISTS "permission_audit_logs_target_user_id_fkey";

ALTER TABLE "permission_audit_logs"
ADD CONSTRAINT "permission_audit_logs_target_user_id_fkey"
FOREIGN KEY ("target_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
