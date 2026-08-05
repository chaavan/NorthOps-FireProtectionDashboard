-- CreateTable
CREATE TABLE "crm_accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "account_type" TEXT NOT NULL DEFAULT 'direct',
    "sales_rep_email" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_account_locations" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address_line_1" TEXT,
    "address_line_2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postal_code" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_account_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_contacts" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "location_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "role" TEXT NOT NULL DEFAULT 'OTHER',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_inspections" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "location_id" TEXT,
    "inspection_type" TEXT NOT NULL DEFAULT 'ANNUAL',
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "inspected_at" TIMESTAMP(3),
    "inspector_name" TEXT,
    "inspector_email" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_deficiencies" (
    "id" TEXT NOT NULL,
    "inspection_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "location_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'MAJOR',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "estimated_value" DECIMAL(12,2),
    "sales_rep_email" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_deficiencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_opportunities" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "location_id" TEXT,
    "deficiency_id" TEXT,
    "estimate_id" TEXT,
    "title" TEXT NOT NULL,
    "opportunity_type" TEXT NOT NULL DEFAULT 'SERVICE_DEFICIENCY',
    "stage" TEXT NOT NULL DEFAULT 'DEFICIENCY_IDENTIFIED',
    "value" DECIMAL(12,2),
    "sales_rep_email" TEXT,
    "scheduled_at" TIMESTAMP(3),
    "won_at" TIMESTAMP(3),
    "lost_at" TIMESTAMP(3),
    "lost_reason" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_estimate_deficiencies" (
    "id" TEXT NOT NULL,
    "estimate_id" TEXT NOT NULL,
    "deficiency_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_estimate_deficiencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_renewals" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "location_id" TEXT,
    "contract_name" TEXT NOT NULL,
    "service_type" TEXT NOT NULL DEFAULT 'INSPECTION_TESTING',
    "renewal_date" TIMESTAMP(3) NOT NULL,
    "annual_value" DECIMAL(12,2),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sales_rep_email" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_renewals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_accounts_name_idx" ON "crm_accounts"("name");
CREATE INDEX "crm_accounts_sales_rep_email_idx" ON "crm_accounts"("sales_rep_email");
CREATE INDEX "crm_account_locations_account_id_idx" ON "crm_account_locations"("account_id");
CREATE INDEX "crm_contacts_account_id_idx" ON "crm_contacts"("account_id");
CREATE INDEX "crm_contacts_email_idx" ON "crm_contacts"("email");
CREATE INDEX "crm_contacts_role_idx" ON "crm_contacts"("role");
CREATE INDEX "crm_inspections_account_id_idx" ON "crm_inspections"("account_id");
CREATE INDEX "crm_inspections_location_id_idx" ON "crm_inspections"("location_id");
CREATE INDEX "crm_inspections_status_idx" ON "crm_inspections"("status");
CREATE INDEX "crm_inspections_inspected_at_idx" ON "crm_inspections"("inspected_at");
CREATE INDEX "crm_deficiencies_inspection_id_idx" ON "crm_deficiencies"("inspection_id");
CREATE INDEX "crm_deficiencies_account_id_idx" ON "crm_deficiencies"("account_id");
CREATE INDEX "crm_deficiencies_status_idx" ON "crm_deficiencies"("status");
CREATE INDEX "crm_deficiencies_sales_rep_email_idx" ON "crm_deficiencies"("sales_rep_email");
CREATE INDEX "crm_opportunities_account_id_idx" ON "crm_opportunities"("account_id");
CREATE INDEX "crm_opportunities_deficiency_id_idx" ON "crm_opportunities"("deficiency_id");
CREATE INDEX "crm_opportunities_estimate_id_idx" ON "crm_opportunities"("estimate_id");
CREATE INDEX "crm_opportunities_stage_idx" ON "crm_opportunities"("stage");
CREATE INDEX "crm_opportunities_sales_rep_email_idx" ON "crm_opportunities"("sales_rep_email");
CREATE UNIQUE INDEX "crm_estimate_deficiencies_estimate_id_deficiency_id_key" ON "crm_estimate_deficiencies"("estimate_id", "deficiency_id");
CREATE INDEX "crm_estimate_deficiencies_estimate_id_idx" ON "crm_estimate_deficiencies"("estimate_id");
CREATE INDEX "crm_estimate_deficiencies_deficiency_id_idx" ON "crm_estimate_deficiencies"("deficiency_id");
CREATE INDEX "crm_renewals_account_id_idx" ON "crm_renewals"("account_id");
CREATE INDEX "crm_renewals_renewal_date_idx" ON "crm_renewals"("renewal_date");
CREATE INDEX "crm_renewals_status_idx" ON "crm_renewals"("status");
CREATE INDEX "crm_renewals_sales_rep_email_idx" ON "crm_renewals"("sales_rep_email");

-- AddForeignKey
ALTER TABLE "crm_account_locations" ADD CONSTRAINT "crm_account_locations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "crm_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "crm_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "crm_account_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_inspections" ADD CONSTRAINT "crm_inspections_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "crm_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_inspections" ADD CONSTRAINT "crm_inspections_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "crm_account_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_deficiencies" ADD CONSTRAINT "crm_deficiencies_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "crm_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_deficiencies" ADD CONSTRAINT "crm_deficiencies_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "crm_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_deficiencies" ADD CONSTRAINT "crm_deficiencies_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "crm_account_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "crm_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "crm_account_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_deficiency_id_fkey" FOREIGN KEY ("deficiency_id") REFERENCES "crm_deficiencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_estimate_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "standalone_estimates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_estimate_deficiencies" ADD CONSTRAINT "crm_estimate_deficiencies_estimate_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "standalone_estimates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_estimate_deficiencies" ADD CONSTRAINT "crm_estimate_deficiencies_deficiency_id_fkey" FOREIGN KEY ("deficiency_id") REFERENCES "crm_deficiencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_renewals" ADD CONSTRAINT "crm_renewals_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "crm_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_renewals" ADD CONSTRAINT "crm_renewals_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "crm_account_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
