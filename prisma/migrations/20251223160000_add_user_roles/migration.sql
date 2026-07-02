-- AlterEnum
-- This migration adds new roles to the UserRole enum
-- Note: PostgreSQL doesn't support removing enum values, so we keep all existing values

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'User'
  ) AND EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'UserRole'
  ) THEN
    CREATE TYPE "UserRole_new" AS ENUM ('ADMIN', 'PROJECT_MANAGER', 'DESIGNER', 'SALES', 'EDITOR', 'VIEWER');

    -- Remove default temporarily
    ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;

    -- Update the column to use the new enum type
    ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole_new" USING "role"::text::"UserRole_new";

    -- Restore default
    ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'VIEWER'::"UserRole_new";

    -- Drop the old enum type
    DROP TYPE IF EXISTS "UserRole";

    -- Rename the new enum type to the original name
    ALTER TYPE "UserRole_new" RENAME TO "UserRole";
  END IF;
END
$$;

