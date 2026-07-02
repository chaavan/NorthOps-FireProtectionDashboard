CREATE TABLE IF NOT EXISTS "job_stock_returns" (
  "id" TEXT NOT NULL,
  "job_number" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "job_stock_returns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "job_stock_return_lines" (
  "id" TEXT NOT NULL,
  "job_stock_return_id" TEXT NOT NULL,
  "part_id" TEXT NOT NULL,
  "part_number" TEXT NOT NULL,
  "returned_quantity" INTEGER NOT NULL,
  "sent_shop_quantity" INTEGER NOT NULL DEFAULT 0,
  "sent_vendor_quantity" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "job_stock_return_lines_pkey" PRIMARY KEY ("id")
);

ALTER TABLE IF EXISTS "job_stock_returns"
  ADD COLUMN IF NOT EXISTS "id" TEXT,
  ADD COLUMN IF NOT EXISTS "job_number" TEXT,
  ADD COLUMN IF NOT EXISTS "actor_user_id" TEXT,
  ADD COLUMN IF NOT EXISTS "note" TEXT,
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE IF EXISTS "job_stock_return_lines"
  ADD COLUMN IF NOT EXISTS "id" TEXT,
  ADD COLUMN IF NOT EXISTS "job_stock_return_id" TEXT,
  ADD COLUMN IF NOT EXISTS "part_id" TEXT,
  ADD COLUMN IF NOT EXISTS "part_number" TEXT,
  ADD COLUMN IF NOT EXISTS "returned_quantity" INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "sent_shop_quantity" INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "sent_vendor_quantity" INTEGER DEFAULT 0;

UPDATE "job_stock_returns"
SET "id" = md5(random()::text || clock_timestamp()::text)
WHERE "id" IS NULL;

UPDATE "job_stock_returns"
SET "created_at" = CURRENT_TIMESTAMP
WHERE "created_at" IS NULL;

UPDATE "job_stock_return_lines"
SET "id" = md5(random()::text || clock_timestamp()::text)
WHERE "id" IS NULL;

UPDATE "job_stock_return_lines"
SET
  "returned_quantity" = COALESCE("returned_quantity", 0),
  "sent_shop_quantity" = COALESCE("sent_shop_quantity", 0),
  "sent_vendor_quantity" = COALESCE("sent_vendor_quantity", 0);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_stock_returns_pkey'
  ) AND NOT EXISTS (
    SELECT 1 FROM "job_stock_returns" WHERE "id" IS NULL
  ) THEN
    ALTER TABLE "job_stock_returns" ALTER COLUMN "id" SET NOT NULL;
    ALTER TABLE "job_stock_returns" ADD CONSTRAINT "job_stock_returns_pkey" PRIMARY KEY ("id");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_stock_return_lines_pkey'
  ) AND NOT EXISTS (
    SELECT 1 FROM "job_stock_return_lines" WHERE "id" IS NULL
  ) THEN
    ALTER TABLE "job_stock_return_lines" ALTER COLUMN "id" SET NOT NULL;
    ALTER TABLE "job_stock_return_lines" ADD CONSTRAINT "job_stock_return_lines_pkey" PRIMARY KEY ("id");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "job_stock_returns_job_number_idx" ON "job_stock_returns"("job_number");
CREATE INDEX IF NOT EXISTS "job_stock_returns_actor_user_id_idx" ON "job_stock_returns"("actor_user_id");
CREATE INDEX IF NOT EXISTS "job_stock_returns_created_at_idx" ON "job_stock_returns"("created_at");
CREATE INDEX IF NOT EXISTS "job_stock_return_lines_job_stock_return_id_idx" ON "job_stock_return_lines"("job_stock_return_id");
CREATE INDEX IF NOT EXISTS "job_stock_return_lines_part_id_idx" ON "job_stock_return_lines"("part_id");
CREATE INDEX IF NOT EXISTS "job_stock_return_lines_part_number_idx" ON "job_stock_return_lines"("part_number");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_stock_returns_actor_user_id_fkey'
  ) AND NOT EXISTS (
    SELECT 1
    FROM "job_stock_returns" jsr
    LEFT JOIN "User" u ON u."id" = jsr."actor_user_id"
    WHERE jsr."actor_user_id" IS NOT NULL AND u."id" IS NULL
  ) THEN
    ALTER TABLE "job_stock_returns"
      ADD CONSTRAINT "job_stock_returns_actor_user_id_fkey"
      FOREIGN KEY ("actor_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_stock_return_lines_job_stock_return_id_fkey'
  ) AND NOT EXISTS (
    SELECT 1
    FROM "job_stock_return_lines" jsrl
    LEFT JOIN "job_stock_returns" jsr ON jsr."id" = jsrl."job_stock_return_id"
    WHERE jsrl."job_stock_return_id" IS NOT NULL AND jsr."id" IS NULL
  ) THEN
    ALTER TABLE "job_stock_return_lines"
      ADD CONSTRAINT "job_stock_return_lines_job_stock_return_id_fkey"
      FOREIGN KEY ("job_stock_return_id") REFERENCES "job_stock_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_stock_return_lines_part_id_fkey'
  ) AND NOT EXISTS (
    SELECT 1
    FROM "job_stock_return_lines" jsrl
    LEFT JOIN "parts" p ON p."id" = jsrl."part_id"
    WHERE jsrl."part_id" IS NOT NULL AND p."id" IS NULL
  ) THEN
    ALTER TABLE "job_stock_return_lines"
      ADD CONSTRAINT "job_stock_return_lines_part_id_fkey"
      FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
