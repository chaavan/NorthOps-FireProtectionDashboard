-- Add reorder-snooze support so users can cancel/dismiss an inventory reorder
-- suggestion from the "To Order" tab. Additive + nullable — safe to apply online.
ALTER TABLE "parts" ADD COLUMN "reorder_snoozed_at" TIMESTAMP(3);
