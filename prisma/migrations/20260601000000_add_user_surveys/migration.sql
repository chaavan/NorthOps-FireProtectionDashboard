DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'SurveyStatus'
  ) THEN
    CREATE TYPE "SurveyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "surveys" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "status" "SurveyStatus" NOT NULL DEFAULT 'DRAFT',
    "questions" JSONB NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    CONSTRAINT "surveys_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "survey_responses" (
    "id" TEXT NOT NULL,
    "survey_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_email" TEXT NOT NULL,
    "user_name" TEXT,
    "department" TEXT,
    "answers" JSONB NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "survey_responses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "surveys_version_key" ON "surveys"("version");
CREATE INDEX IF NOT EXISTS "surveys_status_idx" ON "surveys"("status");
CREATE INDEX IF NOT EXISTS "surveys_created_at_idx" ON "surveys"("created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "survey_responses_survey_id_user_id_key"
  ON "survey_responses"("survey_id", "user_id");
CREATE INDEX IF NOT EXISTS "survey_responses_survey_id_idx" ON "survey_responses"("survey_id");
CREATE INDEX IF NOT EXISTS "survey_responses_user_id_idx" ON "survey_responses"("user_id");
CREATE INDEX IF NOT EXISTS "survey_responses_user_email_idx" ON "survey_responses"("user_email");
CREATE INDEX IF NOT EXISTS "survey_responses_submitted_at_idx" ON "survey_responses"("submitted_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'survey_responses_survey_id_fkey'
  ) THEN
    ALTER TABLE "survey_responses"
      ADD CONSTRAINT "survey_responses_survey_id_fkey"
      FOREIGN KEY ("survey_id") REFERENCES "surveys"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'survey_responses_user_id_fkey'
  ) THEN
    ALTER TABLE "survey_responses"
      ADD CONSTRAINT "survey_responses_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
