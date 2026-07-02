-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN IF NOT EXISTS "from_shop_na" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "deliveries" ADD COLUMN IF NOT EXISTS "from_suppliers_na" BOOLEAN NOT NULL DEFAULT false;
