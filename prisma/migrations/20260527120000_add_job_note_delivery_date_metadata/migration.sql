-- AlterTable
ALTER TABLE "job_notes" ADD COLUMN IF NOT EXISTS "note_kind" TEXT;
ALTER TABLE "job_notes" ADD COLUMN IF NOT EXISTS "delivery_date_from" TIMESTAMP(3);
ALTER TABLE "job_notes" ADD COLUMN IF NOT EXISTS "delivery_date_to" TIMESTAMP(3);
