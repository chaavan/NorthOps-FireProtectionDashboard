DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'EstimateStatus' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE "EstimateStatus" AS ENUM ('DRAFT', 'ACTIVE');
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "estimates" (
    "id" TEXT NOT NULL,
    "job_number" TEXT NOT NULL,
    "list_number" TEXT NOT NULL DEFAULT '1',
    "job_name" TEXT NOT NULL,
    "template_key" TEXT NOT NULL DEFAULT 'system-1',
    "template_version" TEXT NOT NULL DEFAULT 'system-1-v1',
    "status" "EstimateStatus" NOT NULL DEFAULT 'DRAFT',
    "data" JSONB NOT NULL,
    "subtotal" DECIMAL(12,2),
    "total_cost" DECIMAL(12,2),
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "estimates_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "job_number" TEXT;
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "list_number" TEXT DEFAULT '1';
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "job_name" TEXT;
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "template_key" TEXT DEFAULT 'system-1';
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "template_version" TEXT DEFAULT 'system-1-v1';
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "status" "EstimateStatus" DEFAULT 'DRAFT';
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "data" JSONB;
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "subtotal" DECIMAL(12,2);
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "total_cost" DECIMAL(12,2);
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "updated_by" TEXT;
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "estimate_revisions" (
    "id" TEXT NOT NULL,
    "estimate_id" TEXT NOT NULL,
    "job_number" TEXT NOT NULL,
    "list_number" TEXT NOT NULL DEFAULT '1',
    "template_key" TEXT NOT NULL DEFAULT 'system-1',
    "template_version" TEXT NOT NULL DEFAULT 'system-1-v1',
    "label" TEXT,
    "snapshot" JSONB NOT NULL,
    "subtotal" DECIMAL(12,2),
    "total_cost" DECIMAL(12,2),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estimate_revisions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "estimate_revisions" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "estimate_revisions" ADD COLUMN IF NOT EXISTS "estimate_id" TEXT;
ALTER TABLE "estimate_revisions" ADD COLUMN IF NOT EXISTS "job_number" TEXT;
ALTER TABLE "estimate_revisions" ADD COLUMN IF NOT EXISTS "list_number" TEXT DEFAULT '1';
ALTER TABLE "estimate_revisions" ADD COLUMN IF NOT EXISTS "template_key" TEXT DEFAULT 'system-1';
ALTER TABLE "estimate_revisions" ADD COLUMN IF NOT EXISTS "template_version" TEXT DEFAULT 'system-1-v1';
ALTER TABLE "estimate_revisions" ADD COLUMN IF NOT EXISTS "label" TEXT;
ALTER TABLE "estimate_revisions" ADD COLUMN IF NOT EXISTS "snapshot" JSONB;
ALTER TABLE "estimate_revisions" ADD COLUMN IF NOT EXISTS "subtotal" DECIMAL(12,2);
ALTER TABLE "estimate_revisions" ADD COLUMN IF NOT EXISTS "total_cost" DECIMAL(12,2);
ALTER TABLE "estimate_revisions" ADD COLUMN IF NOT EXISTS "created_by" TEXT;
ALTER TABLE "estimate_revisions" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "estimates_job_number_list_number_template_key_key"
ON "estimates"("job_number", "list_number", "template_key");

CREATE INDEX IF NOT EXISTS "estimates_job_number_list_number_idx"
ON "estimates"("job_number", "list_number");

CREATE INDEX IF NOT EXISTS "estimates_updated_at_idx"
ON "estimates"("updated_at");

CREATE INDEX IF NOT EXISTS "estimate_revisions_estimate_id_created_at_idx"
ON "estimate_revisions"("estimate_id", "created_at");

CREATE INDEX IF NOT EXISTS "estimate_revisions_job_number_list_number_created_at_idx"
ON "estimate_revisions"("job_number", "list_number", "created_at");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'estimate_revisions_estimate_id_fkey'
    ) THEN
        ALTER TABLE "estimate_revisions"
        ADD CONSTRAINT "estimate_revisions_estimate_id_fkey"
        FOREIGN KEY ("estimate_id") REFERENCES "estimates"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;
