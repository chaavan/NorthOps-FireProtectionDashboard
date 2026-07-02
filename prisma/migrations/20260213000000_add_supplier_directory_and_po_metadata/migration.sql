-- CreateTable
CREATE TABLE IF NOT EXISTS "supplier_directory" (
  "id" TEXT NOT NULL,
  "supplier_key" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "to_emails" JSONB NOT NULL,
  "cc_emails" JSONB,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "supplier_directory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_directory_supplier_key_key" ON "supplier_directory"("supplier_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supplier_directory_display_name_idx" ON "supplier_directory"("display_name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supplier_directory_is_active_idx" ON "supplier_directory"("is_active");

-- AlterTable
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'purchase_orders'
  ) THEN
    ALTER TABLE "purchase_orders"
      ADD COLUMN IF NOT EXISTS "supplier" TEXT,
      ADD COLUMN IF NOT EXISTS "recipient_to" JSONB,
      ADD COLUMN IF NOT EXISTS "recipient_cc" JSONB,
      ADD COLUMN IF NOT EXISTS "send_status" TEXT NOT NULL DEFAULT 'SENT',
      ADD COLUMN IF NOT EXISTS "send_error" TEXT,
      ADD COLUMN IF NOT EXISTS "batch_id" TEXT;

    CREATE INDEX IF NOT EXISTS "purchase_orders_batch_id_idx" ON "purchase_orders"("batch_id");
    CREATE INDEX IF NOT EXISTS "purchase_orders_supplier_idx" ON "purchase_orders"("supplier");
  END IF;
END
$$;

