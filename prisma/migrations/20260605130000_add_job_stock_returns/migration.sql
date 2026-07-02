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
  ) THEN
    ALTER TABLE "job_stock_return_lines"
      ADD CONSTRAINT "job_stock_return_lines_part_id_fkey"
      FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
