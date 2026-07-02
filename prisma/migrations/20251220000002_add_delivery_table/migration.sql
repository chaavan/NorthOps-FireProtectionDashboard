-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "job_number" TEXT NOT NULL,
    "job_area" TEXT,
    "job_name" TEXT,
    "date" TIMESTAMP(3),
    "address" TEXT,
    "fab_pipes" BOOLEAN NOT NULL DEFAULT false,
    "loose_pipes" BOOLEAN NOT NULL DEFAULT false,
    "thd_fittings" BOOLEAN NOT NULL DEFAULT false,
    "nipples" BOOLEAN NOT NULL DEFAULT false,
    "grvd_fittings" BOOLEAN NOT NULL DEFAULT false,
    "valves" BOOLEAN NOT NULL DEFAULT false,
    "heads" BOOLEAN NOT NULL DEFAULT false,
    "hangers" BOOLEAN NOT NULL DEFAULT false,
    "rod_strut" BOOLEAN NOT NULL DEFAULT false,
    "flex_drops" BOOLEAN NOT NULL DEFAULT false,
    "cpvc_pipes" BOOLEAN NOT NULL DEFAULT false,
    "quick_drops" BOOLEAN NOT NULL DEFAULT false,
    "pipe_stand" BOOLEAN NOT NULL DEFAULT false,
    "compressor" BOOLEAN NOT NULL DEFAULT false,
    "backflow" BOOLEAN NOT NULL DEFAULT false,
    "signs" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "location_row" TEXT,
    "location_column" TEXT,
    "boxes" TEXT,
    "skids" TEXT,
    "bags" TEXT,
    "bundles" TEXT,
    "pickup_galloup" BOOLEAN NOT NULL DEFAULT false,
    "pickup_etna" BOOLEAN NOT NULL DEFAULT false,
    "pickup_viking" BOOLEAN NOT NULL DEFAULT false,
    "pickup_other" TEXT,
    "delivery_galloup" BOOLEAN NOT NULL DEFAULT false,
    "delivery_etna" BOOLEAN NOT NULL DEFAULT false,
    "delivery_viking" BOOLEAN NOT NULL DEFAULT false,
    "delivery_other" TEXT,
    "fitter_picking_up_material" BOOLEAN NOT NULL DEFAULT false,
    "picker" TEXT,
    "picker_date" TIMESTAMP(3),
    "receiver" TEXT,
    "receiver_date" TIMESTAMP(3),
    "loader_driver" TEXT,
    "fitter" TEXT,
    "material_date" TIMESTAMP(3),
    "notes" TEXT,
    "backorders_etna_ordered" BOOLEAN NOT NULL DEFAULT false,
    "backorders_galloup_ordered" BOOLEAN NOT NULL DEFAULT false,
    "backorders_viking_ordered" BOOLEAN NOT NULL DEFAULT false,
    "backorders_coremain_ordered" BOOLEAN NOT NULL DEFAULT false,
    "backorders_etna_partial" BOOLEAN NOT NULL DEFAULT false,
    "backorders_galloup_partial" BOOLEAN NOT NULL DEFAULT false,
    "backorders_viking_partial" BOOLEAN NOT NULL DEFAULT false,
    "backorders_coremain_partial" BOOLEAN NOT NULL DEFAULT false,
    "backorders_etna_received" BOOLEAN NOT NULL DEFAULT false,
    "backorders_galloup_received" BOOLEAN NOT NULL DEFAULT false,
    "backorders_viking_received" BOOLEAN NOT NULL DEFAULT false,
    "backorders_coremain_received" BOOLEAN NOT NULL DEFAULT false,
    "from_shop_complete" BOOLEAN NOT NULL DEFAULT false,
    "from_shop_still_need" BOOLEAN NOT NULL DEFAULT false,
    "from_suppliers_complete" BOOLEAN NOT NULL DEFAULT false,
    "from_suppliers_still_need" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deliveries_job_number_idx" ON "deliveries"("job_number");

-- CreateIndex
CREATE INDEX "deliveries_date_idx" ON "deliveries"("date");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "deliveries_job_number_key" ON "deliveries"("job_number");

