import { prisma } from './prisma';
import { DEFAULT_LIST_NUMBER, normalizeListContextForLookup } from './jobListContext';

export const JOB_ACCESS_SOURCES = {
  MANUAL: 'MANUAL',
  CREATOR: 'CREATOR',
  INITIAL_GRANT: 'INITIAL_GRANT',
  AUTO_ALL_JOBS: 'AUTO_ALL_JOBS',
} as const;

export type JobAccessSource = (typeof JOB_ACCESS_SOURCES)[keyof typeof JOB_ACCESS_SOURCES];

function normalizeJobAccessSource(source?: string | null): JobAccessSource {
  return Object.values(JOB_ACCESS_SOURCES).includes(source as JobAccessSource)
    ? (source as JobAccessSource)
    : JOB_ACCESS_SOURCES.MANUAL;
}

function shouldUpdateAccessSource(
  currentSource: string | null | undefined,
  nextSource: JobAccessSource,
): boolean {
  const current = normalizeJobAccessSource(currentSource);
  if (current === nextSource) return false;
  if (nextSource === JOB_ACCESS_SOURCES.AUTO_ALL_JOBS) return current === JOB_ACCESS_SOURCES.AUTO_ALL_JOBS;
  return true;
}

/**
 * Job Access Control Helper Functions
 *
 * `JobAccess` is pure gatekeeping: a row's existence means that user may open
 * this job/list at all. What they can actually DO once inside is governed
 * entirely by the granular permission system (lib/permissions.ts), optionally
 * overridden per job/list/person via `JobPermissionOverride` — see
 * `hasPermission` in lib/permissions.ts for the merge logic.
 */

/**
 * Check if a user can access a job
 * @param userEmail - User's email address
 * @param jobNumber - Job number to check
 * @param listNumberContext - Optional list number to scope the check to
 * @returns true if user has access, false otherwise
 */
export async function canAccessJob(
  userEmail: string,
  jobNumber: string,
  listNumberContext?: string | null,
): Promise<boolean> {
  if (!userEmail || !jobNumber) return false;

  const normalizedJobNumber = jobNumber.trim();
  const normalizedEmail = userEmail.trim().toLowerCase();
  const normalizedListNumber = listNumberContext
    ? normalizeListContextForLookup(listNumberContext)
    : null;

  let access = await prisma.jobAccess.findFirst({
    where: {
      jobNumber: normalizedJobNumber,
      userEmail: normalizedEmail,
      ...(normalizedListNumber ? { listNumber: normalizedListNumber } : {}),
    },
  });

  // Backward-compatible read fallback: if list-specific access is missing,
  // reuse list "1" access without mutating DB during read paths.
  if (!access && normalizedListNumber && normalizedListNumber !== DEFAULT_LIST_NUMBER) {
    access = await prisma.jobAccess.findFirst({
      where: {
        jobNumber: normalizedJobNumber,
        userEmail: normalizedEmail,
        listNumber: DEFAULT_LIST_NUMBER,
      },
    });
  }

  return !!access;
}

/**
 * Get all jobs a user has access to
 * @param userEmail - User's email address
 * @returns Array of job numbers the user can access
 */
export async function getJobsForUser(userEmail: string): Promise<string[]> {
  if (!userEmail) return [];

  const accesses = await prisma.jobAccess.findMany({
    where: {
      userEmail: userEmail.trim().toLowerCase(),
    },
    select: {
      jobNumber: true,
    },
  });

  return accesses.map((a) => a.jobNumber);
}

/**
 * Get all users with access to a job
 * @param jobNumber - Job number
 * @returns Array of access records with user email
 */
export async function getJobAccessList(
  jobNumber: string,
  listNumberContext?: string | null,
): Promise<Array<{
  userEmail: string;
  source: JobAccessSource;
  createdAt: Date;
  updatedAt: Date;
}>> {
  const normalizedJobNumber = jobNumber.trim();
  const normalizedListNumber = listNumberContext
    ? normalizeListContextForLookup(listNumberContext)
    : null;

  const accesses = await prisma.jobAccess.findMany({
    where: {
      jobNumber: normalizedJobNumber,
      ...(normalizedListNumber ? { listNumber: normalizedListNumber } : {}),
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  return accesses.map((a) => ({
    userEmail: a.userEmail,
    source: normalizeJobAccessSource(a.source),
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }));
}

/**
 * Grant a user access to a job (gatekeeping only — does not affect what they
 * can do once inside; that's governed by their role permissions plus any
 * JobPermissionOverride rows).
 * @param jobNumber - Job number
 * @param userEmail - User's email address
 */
export async function setJobAccess(
  jobNumber: string,
  userEmail: string,
  listNumberContext?: string | null,
  source?: JobAccessSource,
) {
  const normalizedJobNumber = jobNumber.trim();
  const normalizedEmail = userEmail.trim().toLowerCase();
  const normalizedListNumber = normalizeListContextForLookup(listNumberContext);
  const normalizedSource = normalizeJobAccessSource(source);

  try {
    const existing = await prisma.jobAccess.findUnique({
      where: {
        jobNumber_listNumber_userEmail: {
          jobNumber: normalizedJobNumber,
          listNumber: normalizedListNumber,
          userEmail: normalizedEmail,
        },
      },
      select: { id: true, source: true },
    });
    if (existing) {
      return await prisma.jobAccess.update({
        where: { id: existing.id },
        data: {
          ...(shouldUpdateAccessSource(existing.source, normalizedSource)
            ? { source: normalizedSource }
            : {}),
          updatedAt: new Date(),
        },
      });
    }

    // Preferred path for databases that have the correct unique index
    return await prisma.jobAccess.create({
      data: {
        jobNumber: normalizedJobNumber,
        listNumber: normalizedListNumber,
        userEmail: normalizedEmail,
        source: normalizedSource,
      },
    });
  } catch (error: any) {
    // Backward-compatible fallback for databases that still have the old
    // unique constraint on (job_number, user_email) without list_number.
    const prismaError = error as { code?: string; meta?: { modelName?: string; target?: string[] } };
    const isLegacyJobAccessConstraint =
      prismaError?.code === 'P2002' &&
      prismaError?.meta?.modelName === 'JobAccess' &&
      Array.isArray(prismaError?.meta?.target) &&
      prismaError.meta.target.length === 2 &&
      prismaError.meta.target.includes('job_number') &&
      prismaError.meta.target.includes('user_email');

    if (!isLegacyJobAccessConstraint) {
      throw error;
    }

    // In the legacy schema, there can only be one JobAccess row per (jobNumber, userEmail).
    // Reuse that single row and just update its listNumber so job creation
    // and access management continue to work instead of failing.
    const existing = await prisma.jobAccess.findFirst({
      where: {
        jobNumber: normalizedJobNumber,
        userEmail: normalizedEmail,
      },
    });

    if (existing) {
      return await prisma.jobAccess.update({
        where: { id: existing.id },
        data: {
          listNumber: normalizedListNumber,
          ...(shouldUpdateAccessSource(existing.source, normalizedSource)
            ? { source: normalizedSource }
            : {}),
          updatedAt: new Date(),
        },
      });
    }

    // No existing record but legacy constraint still present – fall back to create by id.
    return await prisma.jobAccess.create({
      data: {
        jobNumber: normalizedJobNumber,
        listNumber: normalizedListNumber,
        userEmail: normalizedEmail,
        source: normalizedSource,
      },
    });
  }
}

/**
 * Remove user access from a job
 * @param jobNumber - Job number
 * @param userEmail - User's email address
 */
export async function removeJobAccess(
  jobNumber: string,
  userEmail: string,
  listNumberContext?: string | null,
): Promise<void> {
  const normalizedJobNumber = jobNumber.trim();
  const normalizedEmail = userEmail.trim().toLowerCase();
  const listNumber = normalizeListContextForLookup(listNumberContext);

  await prisma.$transaction([
    prisma.jobPermissionOverride.deleteMany({
      where: {
        jobNumber: normalizedJobNumber,
        listNumber,
        userEmail: normalizedEmail,
      },
    }),
    prisma.jobAccess.delete({
      where: {
        jobNumber_listNumber_userEmail: {
          jobNumber: normalizedJobNumber,
          listNumber,
          userEmail: normalizedEmail,
        },
      },
    }),
  ]);
}

/**
 * Check if a job has any access records (for determining if it's a legacy job)
 * @param jobNumber - Job number
 * @returns true if job has access records, false otherwise
 */
export async function jobHasAccessRecords(
  jobNumber: string,
  listNumberContext?: string | null,
): Promise<boolean> {
  const count = await prisma.jobAccess.count({
    where: {
      jobNumber: jobNumber.trim(),
      ...(listNumberContext
        ? { listNumber: normalizeListContextForLookup(listNumberContext) }
        : {}),
    },
  });
  return count > 0;
}

export type AccessibleJobListSummary = {
  listNumber: string;
  area: string | null;
};

/**
 * Filter job lists to those the user may view.
 * Admins and jobs without access records see every list; otherwise per-list access applies.
 */
export async function getAccessibleListsForUser(params: {
  userEmail: string;
  jobNumber: string;
  isAdmin: boolean;
  allLists: AccessibleJobListSummary[];
}): Promise<AccessibleJobListSummary[]> {
  const { userEmail, jobNumber, isAdmin, allLists } = params;
  if (!userEmail?.trim() || !jobNumber?.trim()) return [];
  if (isAdmin) return allLists;

  const hasRecords = await jobHasAccessRecords(jobNumber);
  if (!hasRecords) return allLists;

  const accessible: AccessibleJobListSummary[] = [];
  for (const list of allLists) {
    const canAccess = await canAccessJob(userEmail, jobNumber, list.listNumber);
    if (canAccess) {
      accessible.push(list);
    }
  }
  return accessible;
}

export type JobAccessRow = {
  jobNumber: string;
  listNumber: string;
  userEmail: string;
};

/**
 * Bulk-fetch JobAccess rows for many jobs in one query, for listing endpoints
 * (Calendar, All Jobs, job switcher) that would otherwise need an N+1 lookup
 * per job/list. Pair with buildJobAccessIndex + the *FromIndex helpers below.
 */
export async function getJobAccessRowsForJobNumbers(
  jobNumbers: string[],
): Promise<JobAccessRow[]> {
  const normalized = Array.from(
    new Set(jobNumbers.map((jobNumber) => jobNumber.trim()).filter(Boolean)),
  );
  if (normalized.length === 0) return [];

  return prisma.jobAccess.findMany({
    where: { jobNumber: { in: normalized } },
    select: {
      jobNumber: true,
      listNumber: true,
      userEmail: true,
    },
  });
}

export function buildJobAccessIndex(
  rows: JobAccessRow[],
): Map<string, JobAccessRow[]> {
  const index = new Map<string, JobAccessRow[]>();
  for (const row of rows) {
    const existing = index.get(row.jobNumber);
    if (existing) {
      existing.push(row);
    } else {
      index.set(row.jobNumber, [row]);
    }
  }
  return index;
}

/**
 * In-memory equivalent of jobHasAccessRecords, fed by a prefetched index
 * instead of a DB query. Same semantics: exact-list match only, no list-"1"
 * fallback (matching jobHasAccessRecords itself).
 */
export function jobHasAccessRecordsFromIndex(
  index: Map<string, JobAccessRow[]>,
  jobNumber: string,
  listNumberContext?: string | null,
): boolean {
  const rows = index.get(jobNumber.trim());
  if (!rows || rows.length === 0) return false;
  if (!listNumberContext) return true;

  const normalizedListNumber = normalizeListContextForLookup(listNumberContext);
  return rows.some((row) => row.listNumber === normalizedListNumber);
}

/**
 * In-memory equivalent of canAccessJob, fed by a prefetched index instead of
 * a DB query. Mirrors canAccessJob's backward-compat read fallback: if no row
 * exists for the exact list and the list isn't "1", also check list "1".
 */
export function canAccessJobFromIndex(
  index: Map<string, JobAccessRow[]>,
  userEmail: string,
  jobNumber: string,
  listNumberContext?: string | null,
): boolean {
  if (!userEmail || !jobNumber) return false;

  const rows = index.get(jobNumber.trim());
  if (!rows || rows.length === 0) return false;

  const normalizedEmail = userEmail.trim().toLowerCase();
  const normalizedListNumber = listNumberContext
    ? normalizeListContextForLookup(listNumberContext)
    : null;

  const matches = (listNumber: string) =>
    rows.some(
      (row) => row.listNumber === listNumber && row.userEmail === normalizedEmail,
    );

  if (!normalizedListNumber) {
    return rows.some((row) => row.userEmail === normalizedEmail);
  }

  if (matches(normalizedListNumber)) return true;

  if (normalizedListNumber !== DEFAULT_LIST_NUMBER) {
    return matches(DEFAULT_LIST_NUMBER);
  }

  return false;
}
