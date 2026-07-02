-- Remove the old Vendor Orders preorder workflow and its inventory allocation tables.
-- Job-scoped pre-order tracking remains in job_preorder_lines.

DELETE FROM "purchase_orders"
WHERE "order_kind" = 'PREORDER';

DROP TABLE IF EXISTS "preorder_allocations";
DROP TABLE IF EXISTS "preorder_order_lines";

ALTER TABLE "jobs"
DROP COLUMN IF EXISTS "quantity_preordered";
