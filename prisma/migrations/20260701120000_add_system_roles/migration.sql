-- Super Admin and Developer system roles, plus is_developer on users.

ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "is_developer" BOOLEAN NOT NULL DEFAULT false;

INSERT INTO "roles" ("key", "name", "description", "color_class", "is_system", "is_active", "sort_order")
VALUES
  (
    'SUPER_ADMIN',
    'Super Admin',
    'Full application access without developer tools.',
    'bg-rose-700 text-white',
    true,
    true,
    5
  ),
  (
    'DEVELOPER',
    'Developer',
    'Developer tools and survey administration.',
    'bg-violet-800 text-white',
    true,
    true,
    6
  )
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "color_class" = EXCLUDED."color_class",
  "is_system" = true,
  "is_active" = true,
  "sort_order" = EXCLUDED."sort_order",
  "updated_at" = CURRENT_TIMESTAMP;

-- Existing chosen Super Admins become the SUPER_ADMIN system role.
UPDATE "User"
SET
  "role" = 'SUPER_ADMIN',
  "is_super_admin" = true,
  "is_developer" = false
WHERE "is_super_admin" = true
  AND "role" <> 'DEVELOPER';
