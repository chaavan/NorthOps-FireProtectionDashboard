-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN "partial_delivery_note" TEXT,
ADD COLUMN "partial_delivery_recorded_at" TIMESTAMP(3);
