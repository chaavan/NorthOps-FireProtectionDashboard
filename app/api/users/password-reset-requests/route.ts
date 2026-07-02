import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

/**
 * GET /api/users/password-reset-requests
 * List all pending password reset requests (admin only)
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

    const auth = await requirePermission(session, 'users.password_resets.manage');
    if (!auth.ok) return auth.response;

    // Get all pending password reset requests
    const requests = await prisma.passwordResetRequest.findMany({
      where: {
        status: 'pending',
      },
      select: {
        id: true,
        email: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Enrich with user data if available
    const enrichedRequests = await Promise.all(
      requests.map(async (request) => {
        const user = await prisma.user.findFirst({
          where: {
            email: {
              equals: request.email,
              mode: 'insensitive',
            },
          },
          select: { name: true, role: true },
        });

        return {
          ...request,
          userName: user?.name || null,
          userRole: user?.role || null,
        };
      })
    );

    return NextResponse.json({ requests: enrichedRequests });
  } catch (error) {
    console.error('Error listing password reset requests:', error);
    return NextResponse.json(
      { error: 'Failed to list password reset requests' },
      { status: 500 }
    );
  }
}

