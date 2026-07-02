-- Backfill columns that may be missing in drifted environments.
ALTER TABLE "estimates"
ADD COLUMN IF NOT EXISTS "created_by" TEXT;

ALTER TABLE "deliveries"
ADD COLUMN IF NOT EXISTS "additional_receiver_dates" JSONB;
