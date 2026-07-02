-- Master vendor table (replaces supplier_directory).

CREATE TABLE IF NOT EXISTS "vendors" (
  "id" TEXT NOT NULL,
  "vendor_key" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "to_emails" JSONB NOT NULL DEFAULT '[]',
  "cc_emails" JSONB,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "vendors_vendor_key_key" ON "vendors"("vendor_key");
CREATE INDEX IF NOT EXISTS "vendors_display_name_idx" ON "vendors"("display_name");
CREATE INDEX IF NOT EXISTS "vendors_is_active_idx" ON "vendors"("is_active");

INSERT INTO "vendors" (
  "id",
  "vendor_key",
  "display_name",
  "to_emails",
  "cc_emails",
  "is_active",
  "created_at",
  "updated_at"
)
SELECT
  "id",
  "supplier_key",
  "display_name",
  COALESCE("to_emails", '[]'::jsonb),
  "cc_emails",
  "is_active",
  "created_at",
  "updated_at"
FROM "supplier_directory"
ON CONFLICT ("vendor_key") DO NOTHING;

DROP TABLE IF EXISTS "supplier_directory";
