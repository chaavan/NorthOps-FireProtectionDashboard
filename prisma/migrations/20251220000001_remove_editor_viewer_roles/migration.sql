-- Migration to remove EDITOR and VIEWER roles
-- First, migrate existing users with EDITOR or VIEWER roles to appropriate new roles
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
    -- Migrate EDITOR users to PROJECT_MANAGER (similar permissions)
    UPDATE "User" SET role = 'PROJECT_MANAGER' WHERE role::text = 'EDITOR';

    -- Migrate VIEWER users to DESIGNER (read-only access, similar to viewer)
    UPDATE "User" SET role = 'DESIGNER' WHERE role::text = 'VIEWER';

    -- Remove the default constraint first
    ALTER TABLE "User" ALTER COLUMN role DROP DEFAULT;

    -- Create new enum without EDITOR and VIEWER
    CREATE TYPE "UserRole_new" AS ENUM ('ADMIN', 'PROJECT_MANAGER', 'DESIGNER', 'SALES');

    -- Update the column to use the new enum
    ALTER TABLE "User" ALTER COLUMN role TYPE "UserRole_new" USING role::text::"UserRole_new";

    -- Drop the old enum
    DROP TYPE IF EXISTS "UserRole";

    -- Rename the new enum to the original name
    ALTER TYPE "UserRole_new" RENAME TO "UserRole";

    -- Set the new default value
    ALTER TABLE "User" ALTER COLUMN role SET DEFAULT 'DESIGNER'::"UserRole";
  END IF;
END
$$;
