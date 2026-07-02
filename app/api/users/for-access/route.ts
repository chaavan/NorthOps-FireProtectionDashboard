import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { activeUserWhere } from '@/lib/activeUsers';
import { prisma } from '@/lib/prisma';
import { getEffectivePermissionsForUser } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

/**
 * GET /api/users/for-access
 * Returns all users for access management (Admin, PM, Sales, Designer can access)
 * Used for adding users to job access
 *
 * Optional ?isServiceJob=true|false narrows the list to users whose effective
 * permissions actually let them view that job type (jobs.view_service_jobs /
 * jobs.view_contract_jobs) - otherwise granting access would be a dead end.
 * Omitting the param keeps the unfiltered list (existing behavior).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const isServiceJobParam = request.nextUrl.searchParams.get('isServiceJob');
    const filterByJobType =
      isServiceJobParam === 'true' || isServiceJobParam === 'false';
    const isServiceJob = isServiceJobParam === 'true';

    // Get all users (excluding passwords)
    const users = await prisma.user.findMany({
      where: activeUserWhere,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isSuperAdmin: true,
      },
      orderBy: [
        { name: 'asc' },
        { email: 'asc' },
      ],
    });

    const eligibleUsers = filterByJobType
      ? (
          await Promise.all(
            users.map(async (user) => {
              const details = await getEffectivePermissionsForUser(user);
              const requiredKey = isServiceJob
                ? 'jobs.view_service_jobs'
                : 'jobs.view_contract_jobs';
              const eligible =
                details.isDeveloper ||
                details.isSuperAdmin ||
                details.permissions[requiredKey] === true;
              return eligible ? user : null;
            }),
          )
        ).filter((user): user is (typeof users)[number] => user !== null)
      : users;

    // Format users for the access management UI
    const formattedUsers = eligibleUsers.map(user => ({
      email: user.email,
      name: user.name || null,
      role: user.role,
    }));

    return NextResponse.json({ users: formattedUsers });
  } catch (error) {
    console.error('Error in /api/users/for-access:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
