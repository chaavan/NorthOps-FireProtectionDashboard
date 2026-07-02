-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN "backorders_other_ordered" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "deliveries" ADD COLUMN "backorders_other_partial" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "deliveries" ADD COLUMN "backorders_other_received" BOOLEAN NOT NULL DEFAULT false;
