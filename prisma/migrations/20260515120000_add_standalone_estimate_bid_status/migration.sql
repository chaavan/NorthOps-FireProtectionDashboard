ALTER TABLE "standalone_estimates"
  ADD COLUMN IF NOT EXISTS "bid_status" TEXT NOT NULL DEFAULT 'DRAFT';

UPDATE "standalone_estimates"
SET "bid_status" = CASE
  WHEN "archived" = true THEN 'ARCHIVED'
  ELSE 'DRAFT'
END
WHERE "bid_status" IS NULL OR "bid_status" = '';

CREATE INDEX IF NOT EXISTS "se_estimates_bid_status_updated_idx"
  ON "standalone_estimates"("bid_status", "updated_at");
