import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  getSystemRoleActor,
  requireDeveloperActorForTargetDeveloper,
  requirePermission,
  requireSuperAdminActorForTargetSuperAdmin,
  resolvePermissionActorId,
} from '@/lib/permissions';
import { validateAssignableRole } from '@/lib/roleService';
import {
  canActorChangeUserRole,
  isDeveloperBootstrapEmail,
  isSuperAdminRoleKey,
  resolveIsSuperAdmin,
  SYSTEM_ROLE_KEYS,
} from '@/lib/systemRoles';
import { buildUserUpdateForRole } from '@/lib/systemRoleUsers';
import { activeUserWhere } from '@/lib/activeUsers';

export const dynamic = 'force-dynamic';

/**
 * POST /api/users/update-role
 * Update a user's role, including Super Admin and Developer system roles.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const auth = await requirePermission(session, 'users.change_role');
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const { userId, role } = body;

    if (!userId || !role) {
      return NextResponse.json(
        { error: 'userId and role are required' },
        { status: 400 }
      );
    }

    if (!(await validateAssignableRole(role))) {
      return NextResponse.json(
        { error: 'Invalid role. Choose an active role from the role list.' },
        { status: 400 }
      );
    }

    const target = await prisma.user.findFirst({
      where: { id: userId, ...activeUserWhere },
      select: {
        id: true,
        email: true,
        role: true,
        isSuperAdmin: true,
        isDeveloper: true,
      },
    });

    if (!target) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (role === target.role) {
      return NextResponse.json({
        user: target,
        message: 'Role is already set to this value.',
      });
    }

    if (isDeveloperBootstrapEmail(target.email) && role !== SYSTEM_ROLE_KEYS.DEVELOPER) {
      return NextResponse.json(
        { error: 'Developer access for this account is controlled by DEVELOPER_EMAILS' },
        { status: 400 },
      );
    }

    const actor = await getSystemRoleActor(session);
    if (!canActorChangeUserRole(actor, target.role, role)) {
      if (role === SYSTEM_ROLE_KEYS.DEVELOPER) {
        return NextResponse.json(
          { error: 'Only Developers can assign the Developer role' },
          { status: 403 },
        );
      }
      return NextResponse.json(
        { error: 'Only Super Admins or Developers can assign or remove the Super Admin role' },
        { status: 403 },
      );
    }

    if (resolveIsSuperAdmin(target) && !isSuperAdminRoleKey(role)) {
      const superAdminAuth = await requireSuperAdminActorForTargetSuperAdmin(session, target);
      if (!superAdminAuth.ok) return superAdminAuth.response;
    }

    const developerAuth = await requireDeveloperActorForTargetDeveloper(session, target);
    if (!developerAuth.ok) return developerAuth.response;

    if (isSuperAdminRoleKey(target.role) && !isSuperAdminRoleKey(role)) {
      const remaining = await prisma.user.count({
        where: {
          ...activeUserWhere,
          id: { not: target.id },
          OR: [
            { role: SYSTEM_ROLE_KEYS.SUPER_ADMIN },
            { isSuperAdmin: true },
          ],
        },
      });
      if (remaining === 0) {
        return NextResponse.json(
          { error: 'At least one Super Admin must remain' },
          { status: 400 },
        );
      }
    }

    if (userId === (session.user as any).id && role !== target.role) {
      if (resolveIsSuperAdmin(target) && !isSuperAdminRoleKey(role)) {
        return NextResponse.json(
          { error: 'You cannot remove your own Super Admin access' },
          { status: 400 },
        );
      }
      if (target.role === SYSTEM_ROLE_KEYS.DEVELOPER && role !== SYSTEM_ROLE_KEYS.DEVELOPER) {
        return NextResponse.json(
          { error: 'You cannot remove your own Developer access' },
          { status: 400 },
        );
      }
      if (target.role === 'ADMIN' && role !== 'ADMIN') {
        return NextResponse.json(
          { error: 'You cannot change your own role' },
          { status: 400 },
        );
      }
    }

    const roleData = await buildUserUpdateForRole(role);
    const actorUserId = await resolvePermissionActorId(session);

    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: roleData,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isSuperAdmin: true,
          isDeveloper: true,
          updatedAt: true,
        },
      });

      if (target.role !== role) {
        await tx.permissionAuditLog.create({
          data: {
            actorUserId,
            targetUserId: target.id,
            action: 'ROLE_UPDATED',
            before: {
              role: target.role,
              isSuperAdmin: target.isSuperAdmin,
              isDeveloper: target.isDeveloper,
            },
            after: {
              role: updated.role,
              isSuperAdmin: updated.isSuperAdmin,
              isDeveloper: updated.isDeveloper,
            },
          },
        });
      }

      return updated;
    });

    return NextResponse.json({
      user,
      message: 'Role updated. Changes apply on the user’s next page refresh.',
    });
  } catch (error) {
    console.error('Error updating user role:', error);
    return NextResponse.json(
      { error: 'Failed to update user role' },
      { status: 500 }
    );
  }
}
