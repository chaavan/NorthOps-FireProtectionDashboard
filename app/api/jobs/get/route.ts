import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isAdmin, resolveSessionUserRole } from '@/lib/auth';
import { getJobLinesFromDatabase } from '@/lib/jobsDatabase';
import { getEffectivePermissionsForSession } from '@/lib/permissions';
import {
  canViewJobByNumber,
  getJobVisibilityPermissions,
} from '@/lib/jobVisibilityPermissions';
import { canAccessJob } from '@/lib/jobAccess';

// Force this route to be dynamic (not statically generated at build time)
export const dynamic = 'force-dynamic';

/**
 * GET /api/jobs/get?jobNumber=XXX
 * Returns all line items for a specific job from the database
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const jobNumber = searchParams.get('jobNumber');
    const rawListNumberContext = searchParams.get('listNumber');
    const listNumberContext =
      rawListNumberContext && rawListNumberContext !== '__ALL__'
        ? rawListNumberContext
        : null;

    if (!jobNumber) {
      return NextResponse.json(
        { error: 'jobNumber query parameter is required' },
        { status: 400 }
      );
    }

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
    const canViewRequestedJob = await canViewJobByNumber({
      jobNumber,
      listNumber: listNumberContext,
      visibility,
    });
    if (!canViewRequestedJob) {
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to view this job' },
        { status: 403 }
      );
    }

    if (!bypassJobAccess) {
      const userEmail = (session.user as any).email?.trim().toLowerCase() ?? null;
      const hasAccess =
        !!userEmail && (await canAccessJob(userEmail, jobNumber, listNumberContext));
      if (!hasAccess) {
        return NextResponse.json(
          { error: 'Forbidden - You do not have access to this job' },
          { status: 403 },
        );
      }
    }

    const result = await getJobLinesFromDatabase(jobNumber, listNumberContext);

    const freshResponse = NextResponse.json(result);
    freshResponse.headers.set('Cache-Control', 'no-store, max-age=0');
    return freshResponse;
  } catch (error) {
    console.error('Error in /api/jobs/get:', error);
    const message = (error as Error).message;
    const status = message.includes('No line items found') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
