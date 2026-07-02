-- Add received-allocation tracking on preorder allocations.
ALTER TABLE "preorder_allocations"
ADD COLUMN "quantity_received_allocated" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "received_allocated_at" TIMESTAMP(3);
