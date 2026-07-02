import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isUserDeactivated } from '@/lib/activeUsers';
import { prisma } from '@/lib/prisma';
import { requirePermission, requireSuperAdminActorForTargetSuperAdmin, requireDeveloperActorForTargetDeveloper } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/users/delete
 * Terminate a user's access (admin only). The account row is kept so audit logs
 * and history still show their name and email.
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 },
      );
    }

    const auth = await requirePermission(session, 'users.terminate');
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 },
      );
    }

    if (userId === (session.user as { id: string }).id) {
      return NextResponse.json(
        { error: 'You cannot terminate your own account' },
        { status: 400 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        isSuperAdmin: true,
        isDeveloper: true,
        deactivatedAt: true,
        password: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 },
      );
    }

    if (isUserDeactivated(user)) {
      return NextResponse.json(
        { error: 'This user is already terminated' },
        { status: 400 },
      );
    }

    const superAdminAuth = await requireSuperAdminActorForTargetSuperAdmin(session, user);
    if (!superAdminAuth.ok) return superAdminAuth.response;

    const developerAuth = await requireDeveloperActorForTargetDeveloper(session, user);
    if (!developerAuth.ok) return developerAuth.response;

    await prisma.$transaction(async (tx) => {
      await tx.session.deleteMany({
        where: { userId },
      });

      await tx.jobLiveViewSession.deleteMany({
        where: { userId },
      });

      await tx.jobAccess.deleteMany({
        where: { userEmail: user.email },
      });

      await tx.passwordResetRequest.deleteMany({
        where: { email: user.email },
      });

      await tx.user.update({
        where: { id: userId },
        data: { deactivatedAt: new Date() },
      });
    });

    return NextResponse.json({
      success: true,
      message: 'User access terminated successfully',
    });
  } catch (error) {
    console.error('Error terminating user access:', error);
    return NextResponse.json(
      { error: 'Failed to terminate user access' },
      { status: 500 },
    );
  }
}
