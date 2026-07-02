-- Drop columns from deliveries
ALTER TABLE IF EXISTS "deliveries" DROP COLUMN IF EXISTS "boxes";
ALTER TABLE IF EXISTS "deliveries" DROP COLUMN IF EXISTS "skids";
ALTER TABLE IF EXISTS "deliveries" DROP COLUMN IF EXISTS "bags";
ALTER TABLE IF EXISTS "deliveries" DROP COLUMN IF EXISTS "bundles";

-- Drop columns from delivery_locations
ALTER TABLE IF EXISTS "delivery_locations" DROP COLUMN IF EXISTS "boxes";
ALTER TABLE IF EXISTS "delivery_locations" DROP COLUMN IF EXISTS "skids";
ALTER TABLE IF EXISTS "delivery_locations" DROP COLUMN IF EXISTS "bags";
ALTER TABLE IF EXISTS "delivery_locations" DROP COLUMN IF EXISTS "bundles";
