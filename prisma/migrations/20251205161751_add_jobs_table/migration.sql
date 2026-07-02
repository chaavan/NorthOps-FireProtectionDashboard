-- CreateTable
CREATE TABLE "jobs" (
    "job_number" TEXT NOT NULL,
    "job_name" TEXT NOT NULL,
    "contract_number" TEXT,
    "list_number" TEXT,
    "area" TEXT,
    "location_ship_to" TEXT,
    "stocklist_delivery_ship_date" TIMESTAMP(3),
    "unit_of_measurement" TEXT,
    "pulled" INTEGER NOT NULL DEFAULT 0,
    "quantity_needed" INTEGER NOT NULL,
    "quantity_ordered" INTEGER,
    "pulled_by" TEXT,
    "pulled_date" TIMESTAMP(3),
    "description" TEXT,
    "ordered" BOOLEAN DEFAULT false,
    "received_from_order" BOOLEAN DEFAULT false,
    "delivered" BOOLEAN DEFAULT false,
    "part_number" TEXT NOT NULL,
    "type" TEXT,
    "part_type" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("job_number", "part_number")
);

-- CreateIndex
CREATE INDEX "jobs_job_number_idx" ON "jobs"("job_number");

-- CreateIndex
CREATE INDEX "jobs_part_number_idx" ON "jobs"("part_number");

-- CreateIndex
CREATE INDEX "jobs_job_name_idx" ON "jobs"("job_name");

