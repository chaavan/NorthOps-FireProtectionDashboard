import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { getHierarchyGroupKeys, type PermissionKey } from '@/lib/permissionCatalog';

const prisma = new PrismaClient();

// Mirrors lib/permissions.ts's JOB_OVERRIDABLE_KEYS (duplicated here rather
// than imported, since lib/permissions.ts pulls in the "server-only" package
// which isn't resolvable outside the Next.js build).
const JOB_OVERRIDABLE_KEYS = new Set<PermissionKey>(
  getHierarchyGroupKeys("jobs").filter(
    (key) =>
      key !== "jobs.view" &&
      key !== "jobs.view_contract_jobs" &&
      key !== "jobs.view_service_jobs",
  ),
);

// The old per-job accessLevel -> granular permission mapping, recovered from
// the pre-migration version of lib/permissions.ts's jobAccessGrants(). Used
// one time here to convert existing JobAccess.access_level values into
// equivalent JobPermissionOverride rows before the access_level column is
// dropped, so today's effective per-job restrictions are preserved exactly.
const JOB_VIEW_KEYS = new Set<PermissionKey>([
  "job.puller.view",
  "job.delivery.view",
  "job.notes.view",
  "job.access.view",
]);

const JOB_DESIGNER_KEYS = new Set<PermissionKey>([
  ...JOB_VIEW_KEYS,
  "job.puller.pull_from_shop",
  "job.puller.order",
  "job.puller.edit_line",
  "job.puller.add_line",
  "job.puller.import_update_pdf",
  "job.delivery.edit",
  "job.delivery.mark_delivered",
  "job.delivery.mark_pickup",
  "job.delivery.partial_delivery",
  "job.preorder.view",
  "job.preorder.edit",
  "job.preorder.receive",
  "job.preorder.undo_receive",
  "job.stock_back.view",
  "job.stock_back.create",
  "job.stock_back.undo",
  "job.notes.add",
  "job.notes.edit",
  "job.notes.delete",
  "job.notes.upload_packing_slips",
]);

const JOB_SALES_KEYS = new Set<PermissionKey>([...JOB_DESIGNER_KEYS]);

const JOB_PM_KEYS = new Set<PermissionKey>([
  ...JOB_DESIGNER_KEYS,
  "job.puller.delete_line",
  "job.purchase_order.view",
  "job.access.manage",
]);

function grantedKeysForLevel(level: string): Set<PermissionKey> {
  switch (level) {
    case "VIEWER":
      return JOB_VIEW_KEYS;
    case "DESIGNER":
      return JOB_DESIGNER_KEYS;
    case "SALES":
      return JOB_SALES_KEYS;
    case "PROJECT_MANAGER":
      return JOB_PM_KEYS;
    default:
      return new Set();
  }
}

type LegacyJobAccessRow = {
  job_number: string;
  list_number: string;
  user_email: string;
  access_level: string;
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const rows = await prisma.$queryRaw<LegacyJobAccessRow[]>`
    SELECT job_number, list_number, user_email, access_level FROM job_access
  `;

  console.log(`Found ${rows.length} existing job_access rows to convert.`);

  let createdOverrides = 0;
  let skippedRows = 0;

  for (const row of rows) {
    const granted = grantedKeysForLevel(row.access_level);
    if (granted.size === 0) {
      console.warn(
        `Skipping ${row.job_number}/${row.list_number}/${row.user_email}: unrecognized access_level "${row.access_level}"`,
      );
      skippedRows += 1;
      continue;
    }

    for (const key of JOB_OVERRIDABLE_KEYS) {
      const isGranted = granted.has(key);
      // PROJECT_MANAGER had everything JOB_OVERRIDABLE_KEYS could express, so
      // no DENY rows are needed for it - leave it on role defaults + the
      // explicit job.access.manage ALLOW below.
      if (row.access_level === 'PROJECT_MANAGER') break;
      if (isGranted) continue;

      if (dryRun) {
        console.log(`[dry-run] DENY ${key} for ${row.user_email} on ${row.job_number}/${row.list_number}`);
      } else {
        await prisma.jobPermissionOverride.upsert({
          where: {
            jobNumber_listNumber_userEmail_permissionKey: {
              jobNumber: row.job_number,
              listNumber: row.list_number,
              userEmail: row.user_email,
              permissionKey: key,
            },
          },
          update: { effect: 'DENY' },
          create: {
            jobNumber: row.job_number,
            listNumber: row.list_number,
            userEmail: row.user_email,
            permissionKey: key,
            effect: 'DENY',
          },
        });
      }
      createdOverrides += 1;
    }

    // PROJECT_MANAGER rows keep the ability to manage access even if their
    // role doesn't otherwise grant job.access.manage.
    if (row.access_level === 'PROJECT_MANAGER') {
      if (dryRun) {
        console.log(`[dry-run] ALLOW job.access.manage for ${row.user_email} on ${row.job_number}/${row.list_number}`);
      } else {
        await prisma.jobPermissionOverride.upsert({
          where: {
            jobNumber_listNumber_userEmail_permissionKey: {
              jobNumber: row.job_number,
              listNumber: row.list_number,
              userEmail: row.user_email,
              permissionKey: 'job.access.manage',
            },
          },
          update: { effect: 'ALLOW' },
          create: {
            jobNumber: row.job_number,
            listNumber: row.list_number,
            userEmail: row.user_email,
            permissionKey: 'job.access.manage',
            effect: 'ALLOW',
          },
        });
      }
      createdOverrides += 1;
    }
  }

  console.log(
    `${dryRun ? '[dry-run] Would create' : 'Created'} ${createdOverrides} JobPermissionOverride rows (skipped ${skippedRows} rows with unrecognized access_level).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
