-- AlterTable
ALTER TABLE IF EXISTS "purchase_orders"
ADD COLUMN IF NOT EXISTS "vendor_po_label" TEXT;

-- CreateIndex
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'purchase_orders'
  ) THEN
    CREATE INDEX IF NOT EXISTS "purchase_orders_vendor_po_label_idx" ON "purchase_orders"("vendor_po_label");
  END IF;
END
$$;
