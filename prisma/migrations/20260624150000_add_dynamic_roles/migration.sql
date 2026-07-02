-- Add DB-backed dashboard roles while preserving existing role keys.

CREATE TABLE IF NOT EXISTS "roles" (
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "color_class" TEXT,
  "is_system" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 100,
  "created_by_user_id" TEXT,
  "updated_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "roles_pkey" PRIMARY KEY ("key")
);

CREATE INDEX IF NOT EXISTS "roles_is_active_idx" ON "roles"("is_active");
CREATE INDEX IF NOT EXISTS "roles_sort_order_idx" ON "roles"("sort_order");

INSERT INTO "roles" ("key", "name", "description", "color_class", "is_system", "is_active", "sort_order")
VALUES
  ('ADMIN', 'Admin', 'Built-in administrator role.', 'bg-red-600 text-white', true, true, 10),
  ('PROJECT_MANAGER', 'Project Manager', 'Built-in project manager role.', 'bg-blue-600 text-white', true, true, 20),
  ('DESIGNER', 'Designer', 'Built-in designer role.', 'bg-purple-600 text-white', true, true, 30),
  ('SALES', 'Sales', 'Built-in sales role.', 'bg-green-600 text-white', true, true, 40),
  ('EDITOR', 'Editor', 'Built-in legacy editor role.', 'bg-amber-600 text-white', true, true, 50),
  ('VIEWER', 'Viewer', 'Built-in read-only role.', 'bg-slate-600 text-white', true, true, 60)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "color_class" = EXCLUDED."color_class",
  "is_system" = true,
  "is_active" = true,
  "sort_order" = EXCLUDED."sort_order",
  "updated_at" = CURRENT_TIMESTAMP;

ALTER TABLE "User"
ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "User"
ALTER COLUMN "role" TYPE TEXT USING "role"::TEXT;

ALTER TABLE "User"
ALTER COLUMN "role" SET DEFAULT 'VIEWER';

ALTER TABLE "role_permission_templates"
ALTER COLUMN "role" TYPE TEXT USING "role"::TEXT;

-- Keep template rows for all built-in roles, including legacy EDITOR.
INSERT INTO "role_permission_templates" ("id", "role", "permission_key", "effect", "created_at", "updated_at")
SELECT
  'role_template_' || md5(r."key" || ':' || p.permission_key),
  r."key",
  p.permission_key,
  'DENY'::"PermissionEffect",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "roles" r
CROSS JOIN (
  SELECT DISTINCT "permission_key" FROM "role_permission_templates"
) p
WHERE r."is_system" = true
ON CONFLICT ("role", "permission_key") DO NOTHING;
