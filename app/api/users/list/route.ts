import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { activeUserWhere } from '@/lib/activeUsers';
import { requirePermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { resolveIsDeveloper, resolveIsSuperAdmin } from '@/lib/systemRoles';

export const dynamic = 'force-dynamic';

/**
 * GET /api/users/list
 * List all users (admin only)
 */
export async function GET(request: NextRequest) {
  try {
    // Check authentication and admin permission
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const auth = await requirePermission(session, 'users.view');
    if (!auth.ok) return auth.response;

    // Get all users (excluding passwords)
    const users = await prisma.user.findMany({
      where: activeUserWhere,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isSuperAdmin: true,
        isDeveloper: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json({
      users: users.map((user) => ({
        ...user,
        isDeveloper: resolveIsDeveloper(user),
        isSuperAdmin: resolveIsSuperAdmin(user),
      })),
    });
  } catch (error) {
    console.error('Error listing users:', error);
    return NextResponse.json(
      { error: 'Failed to list users' },
      { status: 500 }
    );
  }
}

