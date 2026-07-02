-- CreateEnum
CREATE TYPE "SurveyResponseStatus" AS ENUM ('INCOMPLETE', 'COMPLETE');

-- AlterTable
ALTER TABLE "survey_responses" ADD COLUMN "progress" JSONB;
ALTER TABLE "survey_responses" ADD COLUMN "status" "SurveyResponseStatus" NOT NULL DEFAULT 'INCOMPLETE';
ALTER TABLE "survey_responses" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill existing responses as complete
UPDATE "survey_responses" SET "status" = 'COMPLETE' WHERE "submitted_at" IS NOT NULL;

-- Allow null submitted_at for drafts
ALTER TABLE "survey_responses" ALTER COLUMN "submitted_at" DROP NOT NULL;
ALTER TABLE "survey_responses" ALTER COLUMN "submitted_at" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "survey_responses_status_idx" ON "survey_responses"("status");
CREATE INDEX "survey_responses_updated_at_idx" ON "survey_responses"("updated_at");
