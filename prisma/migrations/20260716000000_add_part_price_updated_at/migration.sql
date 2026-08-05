-- Track when a part's catalog cost (price) last changed, independent of the
-- auto-managed "updatedAt" that bumps on every edit. This drives the inventory
-- "Updated" column so it reflects price changes only, not other profile edits.
-- Additive + nullable — safe to apply online.
ALTER TABLE "parts" ADD COLUMN "price_updated_at" TIMESTAMP(3);

-- Backfill from the cost-change ledger (authoritative price history). Parts with
-- no recorded cost change fall back to their creation time, when the opening
-- price was set.
UPDATE "parts" p
SET "price_updated_at" = COALESCE(
  (
    SELECT MAX(pcc."created_at")
    FROM "part_cost_changes" pcc
    WHERE pcc."part_id" = p."id"
  ),
  p."createdAt"
);
