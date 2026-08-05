-- Vendor lead-time tracking: raw order->receipt samples + a cached per-vendor rollup.
-- Additive only (new table + nullable/defaulted columns) — safe to apply online.

ALTER TABLE "vendors" ADD COLUMN "avg_lead_time_days" DOUBLE PRECISION;
ALTER TABLE "vendors" ADD COLUMN "lead_time_sample_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "vendors" ADD COLUMN "lead_time_updated_at" TIMESTAMP(3);

CREATE TABLE "vendor_lead_time_samples" (
    "id" TEXT NOT NULL,
    "vendor_key" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "order_number" TEXT,
    "part_number" TEXT NOT NULL,
    "part_id" TEXT,
    "order_kind" TEXT NOT NULL DEFAULT 'JOB',
    "sent_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "lead_time_days" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_lead_time_samples_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vendor_lead_time_samples_purchase_order_id_part_number_key"
    ON "vendor_lead_time_samples"("purchase_order_id", "part_number");
CREATE INDEX "vendor_lead_time_samples_vendor_key_received_at_idx"
    ON "vendor_lead_time_samples"("vendor_key", "received_at");
CREATE INDEX "vendor_lead_time_samples_part_id_idx"
    ON "vendor_lead_time_samples"("part_id");

ALTER TABLE "vendor_lead_time_samples" ADD CONSTRAINT "vendor_lead_time_samples_part_id_fkey"
    FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
