-- CreateTable
CREATE TABLE "parts" (
    "id" TEXT NOT NULL,
    "company" INTEGER NOT NULL,
    "pn" TEXT NOT NULL,
    "whse" INTEGER NOT NULL,
    "nomenclature" TEXT NOT NULL,
    "cost" DECIMAL(10,2) NOT NULL,
    "retail" DECIMAL(10,2) NOT NULL,
    "type" INTEGER NOT NULL,
    "weight" DECIMAL(10,2),
    "units" TEXT NOT NULL,
    "altPN" TEXT,
    "code" TEXT,
    "vendor" TEXT,
    "date_updated" TEXT,
    "vendor_part_id" TEXT,
    "cost_change_percentage" TEXT,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parts_pn_idx" ON "parts"("pn");

-- CreateIndex
CREATE INDEX "parts_company_idx" ON "parts"("company");

-- CreateIndex
CREATE INDEX "parts_vendor_idx" ON "parts"("vendor");

