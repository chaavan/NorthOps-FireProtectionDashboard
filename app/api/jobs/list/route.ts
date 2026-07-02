import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isAdmin, resolveSessionUserRole } from '@/lib/auth';
import { getJobListFromDatabase } from '@/lib/jobsDatabase';
import { cache, cacheKeys, cacheTTL } from '@/lib/cache';
import type { JobListResponse } from '@/lib/types';
import { getEffectivePermissionsForSession } from '@/lib/permissions';
import {
  canAccessJobLists,
  getJobListTypeMap,
  getJobVisibilityPermissions,
} from '@/lib/jobVisibilityPermissions';
import {
  buildJobAccessIndex,
  canAccessJobFromIndex,
  getJobAccessRowsForJobNumbers,
} from '@/lib/jobAccess';

// Force this route to be dynamic (not statically generated at build time)
export const dynamic = 'force-dynamic';

/**
 * GET /api/jobs/list
 * Returns a list of all unique jobs with summary information from the database.
 * Returns only jobs allowed by the user's job visibility permissions.
 */
export async function GET() {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const permissionDetails = await getEffectivePermissionsForSession(session);
    const visibility = getJobVisibilityPermissions(permissionDetails);
    const role =
      (await resolveSessionUserRole(session)) ?? (session.user as any).role;
    const bypassJobAccess =
      isAdmin(role) ||
      permissionDetails?.isDeveloper === true ||
      permissionDetails?.isSuperAdmin === true;
    const userEmail = (session.user as any).email?.trim().toLowerCase() ?? null;
    if (!canAccessJobLists(visibility)) {
      return NextResponse.json({ jobs: [] });
    }

    // Use the shared full-list cache, then filter per requester.
    const cacheKey = cacheKeys.jobsList();
    const cached = cache.get(cacheKey) as JobListResponse | null;
    const result = cached || await getJobListFromDatabase();
    if (!cached) {
      cache.set(cacheKey, result, cacheTTL.jobsList);
    }

    const jobNumbers = result.jobs.map((job) => job.jobNumber);
    const [typeMap, jobAccessRows] = await Promise.all([
      getJobListTypeMap(jobNumbers),
      bypassJobAccess ? Promise.resolve([]) : getJobAccessRowsForJobNumbers(jobNumbers),
    ]);
    const jobAccessIndex = buildJobAccessIndex(jobAccessRows);

    const jobs = result.jobs.filter((job) => {
      const jobTypes =
        typeMap.get(job.jobNumber) ?? { hasContract: true, hasService: false };
      const visibleByType =
        (jobTypes.hasContract && visibility.canViewContractJobs) ||
        (jobTypes.hasService && visibility.canViewServiceJobs);
      if (!visibleByType) return false;
      if (bypassJobAccess) return true;

      // Job switcher has no per-list output, so show the job if the user
      // can access at least one of its lists; opening a specific restricted
      // list is still blocked by canAccessJob in /api/jobs/get.
      const listsForJob = job.listNumbers?.length ? job.listNumbers : ['1'];
      return listsForJob.some((listNumber) => {
        return !!userEmail && canAccessJobFromIndex(jobAccessIndex, userEmail, job.jobNumber, listNumber);
      });
    });

    return NextResponse.json({ jobs });
  } catch (error) {
    console.error('Error in /api/jobs/list:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
