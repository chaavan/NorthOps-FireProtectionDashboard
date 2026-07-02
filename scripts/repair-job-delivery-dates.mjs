/**
 * Audit and repair calendar delivery-date data.
 *
 * Usage:
 *   node scripts/repair-job-delivery-dates.mjs --dry-run
 *   node scripts/repair-job-delivery-dates.mjs --apply
 */
import 'dotenv/config';
import postgres from 'postgres';

const NO_PARTS_PLACEHOLDER_PART_NUMBER = '__NO_PARTS__';
const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const dryRun = args.has('--dry-run') || !apply;

if (apply && args.has('--dry-run')) {
  console.error('Use either --dry-run or --apply, not both.');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

function staleListKey(row) {
  return `${row.job_number}|${row.stale_list_number || '1'}`;
}

async function findSplitDateLists() {
  return await sql`
    WITH split_lists AS (
      SELECT
        job_number,
        list_number,
        count(DISTINCT delivery_date::date)::int AS distinct_dates,
        array_agg(DISTINCT delivery_date::date::text ORDER BY delivery_date::date::text) AS dates
      FROM jobs
      WHERE delivery_date IS NOT NULL
        AND part_number <> ${NO_PARTS_PLACEHOLDER_PART_NUMBER}
      GROUP BY job_number, list_number
      HAVING count(DISTINCT delivery_date::date) > 1
    )
    SELECT
      s.job_number,
      s.list_number,
      s.distinct_dates,
      s.dates,
      canonical.delivery_date AS canonical_delivery_date
    FROM split_lists s
    JOIN LATERAL (
      SELECT delivery_date
      FROM jobs j
      WHERE j.job_number = s.job_number
        AND j.list_number = s.list_number
      ORDER BY j.part_number ASC
      LIMIT 1
    ) canonical ON true
    ORDER BY s.job_number, s.list_number
  `;
}

async function findOrphanDeliveries() {
  return await sql`
    SELECT d.id, d.job_number, d.list_number, d.date::date::text AS delivery_date, d.job_area
    FROM deliveries d
    LEFT JOIN jobs j
      ON j.job_number = d.job_number
     AND j.list_number = d.list_number
    WHERE j.job_number IS NULL
    ORDER BY d.job_number, d.list_number
  `;
}

async function findStaleLists() {
  return await sql`
    WITH list_summary AS (
      SELECT
        job_number,
        list_number,
        min(delivery_date::date) AS delivery_date,
        count(*)::int AS line_count,
        count(*) FILTER (WHERE part_number <> ${NO_PARTS_PLACEHOLDER_PART_NUMBER})::int AS real_line_count,
        bool_and(coalesce(delivered, false)) AS all_delivered,
        min(area) AS area
      FROM jobs
      GROUP BY job_number, list_number
    ),
    stale_pairs AS (
      SELECT
        a.job_number,
        a.list_number AS stale_list_number,
        a.delivery_date::text AS stale_delivery_date,
        a.line_count AS stale_line_count,
        a.area AS stale_area,
        b.list_number AS superseding_list_number,
        b.delivery_date::text AS superseding_delivery_date,
        b.area AS superseding_area
      FROM list_summary a
      JOIN list_summary b
        ON b.job_number = a.job_number
       AND b.list_number <> a.list_number
       AND b.delivery_date > a.delivery_date
      WHERE a.all_delivered = true
        AND a.real_line_count > 0
        AND a.line_count <= 3
        AND (a.area IS NULL OR trim(a.area) = '' OR upper(trim(a.area)) = 'N/A')
        AND EXISTS (
          SELECT 1
          FROM jobs stale_part
          JOIN jobs superseding_part
            ON superseding_part.job_number = stale_part.job_number
           AND superseding_part.list_number = b.list_number
           AND superseding_part.part_number = stale_part.part_number
           AND superseding_part.part_number <> ${NO_PARTS_PLACEHOLDER_PART_NUMBER}
          WHERE stale_part.job_number = a.job_number
            AND stale_part.list_number = a.list_number
            AND stale_part.part_number <> ${NO_PARTS_PLACEHOLDER_PART_NUMBER}
        )
    ),
    ranked AS (
      SELECT *,
        row_number() OVER (
          PARTITION BY job_number, stale_list_number
          ORDER BY superseding_delivery_date DESC, superseding_list_number ASC
        ) AS rn
      FROM stale_pairs
    )
    SELECT *
    FROM ranked
    WHERE rn = 1
    ORDER BY job_number, stale_list_number
  `;
}

async function normalizeSplitDates(splitLists) {
  for (const row of splitLists) {
    await sql`
      UPDATE jobs
      SET delivery_date = ${row.canonical_delivery_date}
      WHERE job_number = ${row.job_number}
        AND list_number = ${row.list_number}
    `;
  }
}

async function deleteOrphanDeliveries(orphanDeliveries) {
  if (orphanDeliveries.length === 0) return;
  await sql`
    DELETE FROM deliveries
    WHERE id IN ${sql(orphanDeliveries.map((row) => row.id))}
  `;
}

async function deleteStaleLists(staleLists) {
  for (const row of staleLists) {
    await sql.begin(async (tx) => {
      await tx`
        DELETE FROM deliveries
        WHERE job_number = ${row.job_number}
          AND list_number = ${row.stale_list_number}
      `;
      await tx`
        DELETE FROM jobs
        WHERE job_number = ${row.job_number}
          AND list_number = ${row.stale_list_number}
      `;
    });
  }
}

function printTable(title, rows) {
  console.log(`\n${title}: ${rows.length}`);
  if (rows.length > 0) console.table(rows);
}

try {
  console.log(`Mode: ${dryRun ? 'dry-run' : 'apply'}`);

  const [splitLists, orphanDeliveries, staleLists] = await Promise.all([
    findSplitDateLists(),
    findOrphanDeliveries(),
    findStaleLists(),
  ]);

  printTable('Split job/list delivery dates to normalize', splitLists);
  printTable('Orphan delivery records to delete', orphanDeliveries);
  printTable('Stale delivered small lists to delete', staleLists);

  const staleKeys = new Set(staleLists.map(staleListKey));
  if (staleKeys.has('24-1452|8640')) {
    console.log('\nConfirmed 24-1452 / list 8640 is included in stale-list cleanup.');
  }

  if (dryRun) {
    console.log('\nDry run complete. Re-run with --apply to make these changes.');
  } else {
    await normalizeSplitDates(splitLists);
    await deleteOrphanDeliveries(orphanDeliveries);
    await deleteStaleLists(staleLists);
    console.log('\nRepair complete.');
  }
} finally {
  await sql.end({ timeout: 5 });
}
