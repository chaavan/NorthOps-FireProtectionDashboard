-- Add parts "Other" checkbox column to deliveries (Delivery tab Parts section)
ALTER TABLE "deliveries" ADD COLUMN IF NOT EXISTS "other" BOOLEAN NOT NULL DEFAULT false;
