-- AlterTable
ALTER TABLE "standalone_estimates" ADD COLUMN "contract_price" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "estimate_lookup_options" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "normalized_key" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estimate_lookup_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "estimate_lookup_category_active_idx" ON "estimate_lookup_options"("category", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "estimate_lookup_category_key" ON "estimate_lookup_options"("category", "normalized_key");
