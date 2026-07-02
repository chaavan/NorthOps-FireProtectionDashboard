import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, resolveSessionUserRole } from '@/lib/auth';
import { hasPermission, getEffectivePermissionsForSession, getEffectivePermissionsForUser } from '@/lib/permissions';
import { bypassesJobAccessList } from '@/lib/jobScopedAccess';
import { isUserDeactivated } from '@/lib/activeUsers';
import {
  JOB_ACCESS_SOURCES,
  getJobAccessList,
  setJobAccess,
  removeJobAccess,
} from '@/lib/jobAccess';
import { prisma } from '@/lib/prisma';
import { cache, cacheKeys } from '@/lib/cache';
import { sendJobAccessAddedNotification } from '@/lib/notifications';
import { normalizeListContextForLookup } from '@/lib/jobListContext';

export const dynamic = 'force-dynamic';

async function canManageJobAccessNow(
  session: any,
  jobNumber: string,
  listNumber: string,
): Promise<boolean> {
  const role = (await resolveSessionUserRole(session)) ?? (session?.user as any)?.role;
  const permissionDetails = await getEffectivePermissionsForSession(session);
  if (bypassesJobAccessList(role, permissionDetails)) return true;
  return hasPermission(session, 'job.access.manage', { jobNumber, listNumber });
}

/**
 * GET /api/jobs/[jobNumber]/access
 * Returns all users with access to this job
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobNumber: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const { jobNumber } = await params;
    const listNumberContext = normalizeListContextForLookup(
      request.nextUrl.searchParams.get('listNumber')
    );
    // NOTE: We intentionally allow any authenticated dashboard user to view
    // the access list for this job. Management actions (POST/DELETE/
    // permission overrides) remain restricted via canManageJobAccessNow.

    // Get access list
    const accessList = await getJobAccessList(jobNumber, listNumberContext);

    // Enrich with user information
    const enrichedAccess = await Promise.all(
      accessList.map(async (access) => {
        const user = await prisma.user.findUnique({
          where: { email: access.userEmail },
          select: {
            name: true,
            email: true,
            role: true,
          },
        });

        return {
          userEmail: access.userEmail,
          userName: user?.name || null,
          userRole: user?.role || null,
          source: access.source,
          createdAt: access.createdAt,
          updatedAt: access.updatedAt,
        };
      })
    );

    return NextResponse.json({ access: enrichedAccess });
  } catch (error) {
    console.error('Error in /api/jobs/[jobNumber]/access GET:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/jobs/[jobNumber]/access
 * Grant a user access to a job (gatekeeping only). Their capability once
 * inside follows their normal role permissions, optionally overridden via
 * /api/jobs/[jobNumber]/access/permissions.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobNumber: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const { jobNumber } = await params;
    const userEmail = (session.user as any).email;
    const userRole = (session.user as any).role;
    const body = await request.json();
    const listNumberContext = normalizeListContextForLookup(
      typeof body?.listNumberContext === 'string'
        ? body.listNumberContext
        : (typeof body?.listNumber === 'string' ? body.listNumber : null)
    );

    if (!(await canManageJobAccessNow(session, jobNumber, listNumberContext))) {
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to manage access for this job' },
        { status: 403 }
      );
    }

    const { userEmail: targetUserEmail } = body;

    if (!targetUserEmail) {
      return NextResponse.json(
        { error: 'userEmail is required' },
        { status: 400 }
      );
    }

    // Verify target user exists (case-insensitive email lookup so e.g. Lwitt@totalfire.biz matches)
    const normalizedInput = targetUserEmail.trim();
    const targetUser = await prisma.user.findFirst({
      where: {
        email: { equals: normalizedInput, mode: 'insensitive' },
      },
    });

    if (!targetUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    if (isUserDeactivated(targetUser)) {
      return NextResponse.json(
        { error: 'This user no longer has system access' },
        { status: 400 },
      );
    }

    // Use the canonical email from the database for access records and notifications
    const canonicalEmail = targetUser.email;

    // Grant access
    await setJobAccess(
      jobNumber.trim(),
      canonicalEmail,
      listNumberContext,
      JOB_ACCESS_SOURCES.MANUAL,
    );

    // Invalidate cache
    cache.delete(cacheKeys.jobDetails(jobNumber, listNumberContext));
    cache.delete(cacheKeys.jobsList());
    cache.delete(cacheKeys.calendar());

    // Fire access-added notification to the target user (await so webhook runs before Vercel freezes the function)
    await sendJobAccessAddedNotification(
      jobNumber.trim(),
      canonicalEmail,
      userEmail,
      userRole,
      new Date(),
      listNumberContext,
    ).catch((err) => {
      console.error('Error sending job access-added notification:', err);
    });

    return NextResponse.json({
      success: true,
      message: `Access granted to ${canonicalEmail}`
    });
  } catch (error) {
    console.error('Error in /api/jobs/[jobNumber]/access POST:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/jobs/[jobNumber]/access?userEmail=XXX
 * Remove user access from a job
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ jobNumber: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const { jobNumber } = await params;
    const listNumberContext = normalizeListContextForLookup(
      request.nextUrl.searchParams.get('listNumber')
    );

    if (!(await canManageJobAccessNow(session, jobNumber, listNumberContext))) {
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to manage access for this job' },
        { status: 403 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const targetUserEmail = searchParams.get('userEmail');

    if (!targetUserEmail) {
      return NextResponse.json(
        { error: 'userEmail query parameter is required' },
        { status: 400 }
      );
    }
    const normalizedTargetEmail = targetUserEmail.trim().toLowerCase();

    // Prevent removing the last person who can manage this job's access.
    const accessList = await getJobAccessList(jobNumber, listNumberContext);
    const remaining = accessList.filter(
      (a) => a.userEmail.toLowerCase() !== normalizedTargetEmail,
    );

    let anyManagerRemains = false;
    for (const entry of remaining) {
      const user = await prisma.user.findFirst({
        where: { email: { equals: entry.userEmail, mode: 'insensitive' } },
        select: { id: true, email: true, role: true, isSuperAdmin: true },
      });
      if (!user) continue;

      const details = await getEffectivePermissionsForUser(user);
      if (details.isDeveloper || details.isSuperAdmin) {
        anyManagerRemains = true;
        break;
      }

      const override = await prisma.jobPermissionOverride.findUnique({
        where: {
          jobNumber_listNumber_userEmail_permissionKey: {
            jobNumber: jobNumber.trim(),
            listNumber: listNumberContext,
            userEmail: entry.userEmail,
            permissionKey: 'job.access.manage',
          },
        },
      });
      const effective = override
        ? override.effect === 'ALLOW'
        : details.permissions['job.access.manage'] === true;
      if (effective) {
        anyManagerRemains = true;
        break;
      }
    }

    if (!anyManagerRemains) {
      return NextResponse.json(
        {
          error:
            'Cannot remove the last person who can manage access for this job. Grant someone else access management first.',
        },
        { status: 400 },
      );
    }

    // Remove access
    await removeJobAccess(
      jobNumber.trim(),
      normalizedTargetEmail,
      listNumberContext,
    );

    // Invalidate cache
    cache.delete(cacheKeys.jobDetails(jobNumber, listNumberContext));
    cache.delete(cacheKeys.jobsList());
    cache.delete(cacheKeys.calendar());

    return NextResponse.json({
      success: true,
      message: `Access removed for ${targetUserEmail}`
    });
  } catch (error) {
    console.error('Error in /api/jobs/[jobNumber]/access DELETE:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
