/**
 * Inspect delivery dates for a job/list on the calendar.
 * Usage: node scripts/inspect-job-calendar-dates.mjs [jobNumber] [listNumber]
 */
import 'dotenv/config';
import postgres from 'postgres';

const jobNumber = process.argv[2] || '24-1452';
const listNumber = process.argv[3] || '0080';

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

try {
  const rows = await sql`
    SELECT
      job_number,
      list_number,
      job_name,
      area,
      part_number,
      delivery_date::text AS delivery_date,
      delivered
    FROM jobs
    WHERE job_number = ${jobNumber}
      AND list_number = ${listNumber}
    ORDER BY delivery_date, part_number
  `;

  console.log(`Job ${jobNumber} / list ${listNumber}: ${rows.length} line(s)\n`);

  const byDate = new Map();
  for (const row of rows) {
    const date = row.delivery_date?.slice(0, 10) ?? 'NULL';
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(row);
  }

  console.log('Distinct delivery dates:');
  for (const [date, lines] of [...byDate.entries()].sort()) {
    console.log(`  ${date}: ${lines.length} part line(s)`);
  }

  console.log('\nSample lines per date:');
  for (const [date, lines] of [...byDate.entries()].sort()) {
    console.log(`\n--- ${date} ---`);
    for (const line of lines.slice(0, 3)) {
      console.log(
        `  ${line.part_number} | delivered=${line.delivered} | area=${line.area ?? 'N/A'}`,
      );
    }
    if (lines.length > 3) console.log(`  ... and ${lines.length - 3} more`);
  }

  const allLists = await sql`
    SELECT
      list_number,
      delivery_date::date::text AS delivery_date,
      count(*)::int AS line_count,
      bool_and(delivered) AS all_delivered,
      min(area) AS area
    FROM jobs
    WHERE job_number = ${jobNumber}
      AND delivery_date IS NOT NULL
    GROUP BY list_number, delivery_date::date
    ORDER BY delivery_date, list_number
  `;
  console.log('\nAll list/date combos for job:');
  console.table(allLists);

  const deliveryRecord = await sql`
    SELECT job_number, list_number, date::date::text AS delivery_date, is_service_job, job_area
    FROM deliveries
    WHERE job_number = ${jobNumber}
    ORDER BY date, list_number
  `;
  console.log('\nDelivery tab record(s):', deliveryRecord.length ? '' : 'none');
  if (deliveryRecord.length) console.table(deliveryRecord);

  const mixerRows = await sql`
    SELECT list_number, delivery_date::date::text AS d, count(*)::int AS cnt, min(area) AS area
    FROM jobs
    WHERE job_number = ${jobNumber}
      AND area ILIKE ${'%mixer%'}
    GROUP BY list_number, delivery_date::date
    ORDER BY d, list_number
  `;
  console.log('\nRows with Mixer in area:');
  console.table(mixerRows);

  const feb26 = await sql`
    SELECT list_number, part_number, area, delivery_date::date::text AS d, delivered
    FROM jobs
    WHERE job_number = ${jobNumber}
      AND delivery_date::date = '2026-02-26'
  `;
  console.log('\nAll job lines on 2026-02-26:');
  console.table(feb26);

  const listNumbers = await sql`
    SELECT DISTINCT list_number, length(list_number) AS len
    FROM jobs
    WHERE job_number = ${jobNumber}
    ORDER BY list_number
  `;
  console.log('\nDistinct list numbers on job lines:');
  console.table(listNumbers);

  const overlap = await sql`
    SELECT a.part_number, a.list_number AS list_a, a.delivery_date::date::text AS date_a,
           b.list_number AS list_b, b.delivery_date::date::text AS date_b
    FROM jobs a
    JOIN jobs b
      ON a.job_number = b.job_number
     AND a.part_number = b.part_number
     AND a.list_number <> b.list_number
    WHERE a.job_number = ${jobNumber}
    ORDER BY a.part_number, a.list_number
  `;
  console.log('\nDuplicate part numbers across different lists:');
  console.table(overlap);

  const splitDates = await sql`
    SELECT list_number, count(DISTINCT delivery_date::date)::int AS distinct_dates
    FROM jobs
    WHERE job_number = ${jobNumber}
      AND part_number <> '__NO_PARTS__'
    GROUP BY list_number
    HAVING count(DISTINCT delivery_date::date) > 1
  `;
  console.log('\nLists with split delivery dates across part lines:');
  console.table(splitDates.length ? splitDates : [{ note: 'none' }]);
} finally {
  await sql.end({ timeout: 5 });
}
