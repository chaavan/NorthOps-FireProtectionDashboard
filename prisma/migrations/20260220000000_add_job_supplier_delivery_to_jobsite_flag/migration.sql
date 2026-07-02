ALTER TABLE "jobs"
ADD COLUMN IF NOT EXISTS "supplier_delivery_to_jobsite" BOOLEAN DEFAULT false;
