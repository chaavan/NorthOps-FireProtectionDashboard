-- Explicit "don't stock" flag for parts (distinct from a blank Min On Hand).
-- Additive + defaulted — safe to apply online.
ALTER TABLE "parts" ADD COLUMN "do_not_stock" BOOLEAN NOT NULL DEFAULT false;
