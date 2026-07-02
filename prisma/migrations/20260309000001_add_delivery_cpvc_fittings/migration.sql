-- Add CPVC Fittings checkbox to deliveries (Delivery tab Parts section)
ALTER TABLE "deliveries" ADD COLUMN IF NOT EXISTS "cpvc_fittings" BOOLEAN NOT NULL DEFAULT false;
