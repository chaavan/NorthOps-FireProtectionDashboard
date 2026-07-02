ALTER TABLE "jobs"
ADD COLUMN IF NOT EXISTS "quantity_preordered" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "purchase_orders"
ADD COLUMN IF NOT EXISTS "order_kind" TEXT NOT NULL DEFAULT 'JOB';

CREATE TABLE IF NOT EXISTS "preorder_order_lines" (
  "id" TEXT NOT NULL,
  "purchase_order_id" TEXT NOT NULL,
  "order_number" TEXT NOT NULL,
  "part_id" TEXT NOT NULL,
  "part_number" TEXT NOT NULL,
  "description" TEXT,
  "uom" TEXT,
  "supplier" TEXT,
  "vendor" TEXT,
  "quantity_ordered" INTEGER NOT NULL,
  "quantity_received" INTEGER NOT NULL DEFAULT 0,
  "quantity_released_to_shop" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "preorder_order_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "preorder_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "preorder_order_lines_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "preorder_allocations" (
  "id" TEXT NOT NULL,
  "preorder_order_line_id" TEXT NOT NULL,
  "part_id" TEXT NOT NULL,
  "job_number" TEXT NOT NULL,
  "list_number" TEXT NOT NULL DEFAULT '1',
  "part_number" TEXT NOT NULL,
  "quantity_reserved" INTEGER NOT NULL DEFAULT 0,
  "released_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "preorder_allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "preorder_allocations_preorder_order_line_id_fkey" FOREIGN KEY ("preorder_order_line_id") REFERENCES "preorder_order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "preorder_allocations_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "purchase_orders_order_kind_idx" ON "purchase_orders"("order_kind");
CREATE INDEX IF NOT EXISTS "preorder_order_lines_purchase_order_id_idx" ON "preorder_order_lines"("purchase_order_id");
CREATE INDEX IF NOT EXISTS "preorder_order_lines_order_number_idx" ON "preorder_order_lines"("order_number");
CREATE INDEX IF NOT EXISTS "preorder_order_lines_part_id_idx" ON "preorder_order_lines"("part_id");
CREATE INDEX IF NOT EXISTS "preorder_order_lines_part_number_idx" ON "preorder_order_lines"("part_number");
CREATE INDEX IF NOT EXISTS "preorder_order_lines_status_idx" ON "preorder_order_lines"("status");
CREATE INDEX IF NOT EXISTS "preorder_allocations_preorder_order_line_id_idx" ON "preorder_allocations"("preorder_order_line_id");
CREATE INDEX IF NOT EXISTS "preorder_allocations_part_id_idx" ON "preorder_allocations"("part_id");
CREATE INDEX IF NOT EXISTS "preorder_allocations_part_number_idx" ON "preorder_allocations"("part_number");
CREATE INDEX IF NOT EXISTS "preorder_allocations_job_number_list_number_part_number_idx" ON "preorder_allocations"("job_number", "list_number", "part_number");
