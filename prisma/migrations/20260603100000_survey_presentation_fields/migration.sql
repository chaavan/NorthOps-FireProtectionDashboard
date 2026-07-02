-- AlterTable
ALTER TABLE "surveys" ADD COLUMN "tagline" TEXT;
ALTER TABLE "surveys" ADD COLUMN "preface_heading" TEXT;
ALTER TABLE "surveys" ADD COLUMN "preface_message" TEXT;

-- Backfill from legacy defaults
UPDATE "surveys" SET
  "tagline" = 'About 2 minutes · 7 questions',
  "preface_heading" = 'What this survey is for',
  "preface_message" = 'This form is to understand how we can better help and improve our ERP system for TFP. We appreciate your time and feedback and we''re looking forward to hearing all your suggestions.'
WHERE "tagline" IS NULL;
