-- Job-level pre-order redesign: shared pool per job, per-list pulls on job lines.

ALTER TABLE "jobs"
ADD COLUMN IF NOT EXISTS "quantity_pulled_from_preorder" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "job_preorder_lines"
ADD COLUMN IF NOT EXISTS "quantity_received" INTEGER NOT NULL DEFAULT 0;

-- Backfill received qty from legacy RECEIVED status rows.
UPDATE "job_preorder_lines"
SET "quantity_received" = "quantity"
WHERE "status" = 'RECEIVED' AND "quantity_received" < "quantity";

-- Seed per-list consumption from legacy list-scoped RECEIVED pre-order lines.
UPDATE "jobs" AS j
SET "quantity_pulled_from_preorder" = jpl."quantity"
FROM "job_preorder_lines" AS jpl
WHERE j."job_number" = jpl."job_number"
  AND j."list_number" = jpl."list_number"
  AND j."part_number" = jpl."part_number"
  AND jpl."status" = 'RECEIVED';

-- Merge duplicate pre-order lines per job+part (sum qty into newest row, delete others).
WITH "agg" AS (
  SELECT
    "job_number",
    "part_number",
    SUM("quantity") AS "sum_qty",
    SUM("quantity_received") AS "sum_recv"
  FROM "job_preorder_lines"
  WHERE "status" != 'CANCELLED'
  GROUP BY "job_number", "part_number"
),
"keeper" AS (
  SELECT DISTINCT ON ("job_number", "part_number")
    "id",
    "job_number",
    "part_number"
  FROM "job_preorder_lines"
  WHERE "status" != 'CANCELLED'
  ORDER BY "job_number", "part_number", "updated_at" DESC
)
UPDATE "job_preorder_lines" AS jpl
SET
  "quantity" = agg."sum_qty",
  "quantity_received" = agg."sum_recv",
  "status" = CASE
    WHEN agg."sum_recv" >= agg."sum_qty" THEN 'RECEIVED'
    ELSE 'OPEN'
  END
FROM "agg"
JOIN "keeper" AS k
  ON k."job_number" = agg."job_number"
 AND k."part_number" = agg."part_number"
WHERE jpl."id" = k."id";

DELETE FROM "job_preorder_lines"
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY "job_number", "part_number"
        ORDER BY "updated_at" DESC
      ) AS "rn"
    FROM "job_preorder_lines"
    WHERE "status" != 'CANCELLED'
  ) AS ranked
  WHERE "rn" > 1
);

DROP INDEX IF EXISTS "job_preorder_lines_job_number_list_number_idx";
DROP INDEX IF EXISTS "job_preorder_lines_job_number_list_number_part_number_idx";

ALTER TABLE "job_preorder_lines" DROP COLUMN IF EXISTS "list_number";
