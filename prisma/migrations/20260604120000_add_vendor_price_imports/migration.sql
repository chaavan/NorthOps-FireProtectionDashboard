-- CreateEnum
CREATE TYPE "VendorPriceImportStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED', 'COMMITTED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "VendorPriceImportSourceType" AS ENUM ('UPLOAD', 'GMAIL');

-- CreateEnum
CREATE TYPE "VendorPriceImportLineMatchStatus" AS ENUM ('MATCHED', 'CONFLICT_IN_FILE', 'UNMATCHED', 'NO_COST_CHANGE', 'EXCLUDED', 'MATCHED_AMBIGUOUS');

-- CreateTable
CREATE TABLE "vendor_price_profiles" (
    "id" TEXT NOT NULL,
    "vendor_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "match_vendor_key" TEXT NOT NULL,
    "parser_type" TEXT NOT NULL,
    "parser_config" JSONB NOT NULL,
    "gmail_config" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_price_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_price_imports" (
    "id" TEXT NOT NULL,
    "status" "VendorPriceImportStatus" NOT NULL DEFAULT 'PROCESSING',
    "vendor_key" TEXT NOT NULL,
    "source_type" "VendorPriceImportSourceType" NOT NULL DEFAULT 'UPLOAD',
    "source_file_name" TEXT NOT NULL,
    "source_content_type" TEXT,
    "source_file_size" INTEGER NOT NULL DEFAULT 0,
    "source_file_hash" TEXT,
    "source_file_bytes" BYTEA,
    "summary" JSONB,
    "review_snapshot" JSONB,
    "gmail_message_id" TEXT,
    "gmail_attachment_id" TEXT,
    "created_by" TEXT NOT NULL,
    "committed_by" TEXT,
    "committed_at" TIMESTAMP(3),
    "commit_summary" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_price_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_price_import_lines" (
    "id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "vendor_part_id_raw" TEXT,
    "vendor_part_id_normalized" TEXT NOT NULL,
    "description_from_file" TEXT,
    "uom_from_file" TEXT,
    "proposed_cost" DECIMAL(10,2) NOT NULL,
    "match_status" "VendorPriceImportLineMatchStatus" NOT NULL,
    "part_id" TEXT,
    "cost_before" DECIMAL(10,2),
    "cost_after" DECIMAL(10,2),
    "percent_change" DECIMAL(10,4),
    "conflict_group_id" TEXT,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_price_import_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendor_price_profiles_vendor_key_key" ON "vendor_price_profiles"("vendor_key");

-- CreateIndex
CREATE INDEX "vendor_price_imports_status_idx" ON "vendor_price_imports"("status");

-- CreateIndex
CREATE INDEX "vendor_price_imports_vendor_key_idx" ON "vendor_price_imports"("vendor_key");

-- CreateIndex
CREATE INDEX "vendor_price_imports_created_by_idx" ON "vendor_price_imports"("created_by");

-- CreateIndex
CREATE INDEX "vendor_price_imports_created_at_idx" ON "vendor_price_imports"("created_at");

-- CreateIndex
CREATE INDEX "vendor_price_imports_gmail_message_id_gmail_attachment_id_idx" ON "vendor_price_imports"("gmail_message_id", "gmail_attachment_id");

-- CreateIndex
CREATE INDEX "vendor_price_import_lines_import_id_idx" ON "vendor_price_import_lines"("import_id");

-- CreateIndex
CREATE INDEX "vendor_price_import_lines_import_id_match_status_idx" ON "vendor_price_import_lines"("import_id", "match_status");

-- CreateIndex
CREATE INDEX "vendor_price_import_lines_import_id_conflict_group_id_idx" ON "vendor_price_import_lines"("import_id", "conflict_group_id");

-- CreateIndex
CREATE INDEX "vendor_price_import_lines_part_id_idx" ON "vendor_price_import_lines"("part_id");

-- CreateIndex
CREATE INDEX "parts_vendor_part_id_idx" ON "parts"("vendor_part_id");

-- CreateIndex
CREATE INDEX "parts_vendor_vendor_part_id_idx" ON "parts"("vendor", "vendor_part_id");

-- AddForeignKey
ALTER TABLE "vendor_price_imports" ADD CONSTRAINT "vendor_price_imports_vendor_key_fkey" FOREIGN KEY ("vendor_key") REFERENCES "vendor_price_profiles"("vendor_key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_price_imports" ADD CONSTRAINT "vendor_price_imports_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_price_imports" ADD CONSTRAINT "vendor_price_imports_committed_by_fkey" FOREIGN KEY ("committed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_price_import_lines" ADD CONSTRAINT "vendor_price_import_lines_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "vendor_price_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_price_import_lines" ADD CONSTRAINT "vendor_price_import_lines_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed ETNA profile
INSERT INTO "vendor_price_profiles" (
    "id",
    "vendor_key",
    "display_name",
    "match_vendor_key",
    "parser_type",
    "parser_config",
    "gmail_config",
    "is_active",
    "created_at",
    "updated_at"
) VALUES (
    'profile_etna_v1',
    'etna',
    'ETNA',
    'etna',
    'etna_book1_v1',
    '{"columns":{"uom":0,"description":1,"vendorPartId":2,"price":3,"flag":4},"allowedExtensions":["xlsx","xls","csv"],"skipUntilNumericRow":true}'::jsonb,
    NULL,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);
