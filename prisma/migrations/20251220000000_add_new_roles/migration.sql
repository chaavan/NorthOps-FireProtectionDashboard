-- AlterEnum
-- Add new roles to UserRole enum
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'UserRole'
  ) THEN
    ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PROJECT_MANAGER';
    ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'DESIGNER';
    ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SALES';
  END IF;
END
$$;

