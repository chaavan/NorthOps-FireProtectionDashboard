-- AlterTable (IF NOT EXISTS so re-run after resolve --rolled-back is safe)
ALTER TABLE "deliveries" ADD COLUMN IF NOT EXISTS "notes" TEXT;
