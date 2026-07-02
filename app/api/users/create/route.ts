import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { activeUserWhere } from '@/lib/activeUsers';
import { prisma } from '@/lib/prisma';
import { requirePermission, getSystemRoleActor } from '@/lib/permissions';
import { validateAssignableRole } from '@/lib/roleService';
import { canActorAssignSystemRole, SYSTEM_ROLE_KEYS } from '@/lib/systemRoles';
import { buildUserUpdateForRole } from '@/lib/systemRoleUsers';
import bcrypt from 'bcryptjs';

export const dynamic = 'force-dynamic';

/**
 * POST /api/users/create
 * Create a new user (admin only)
 */
export async function POST(request: NextRequest) {
  try {
    // Check authentication and admin permission
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const auth = await requirePermission(session, 'users.add');
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const { email: rawEmail, password, name, role: newUserRole } = body;

    if (!rawEmail || !password || !name) {
      return NextResponse.json(
        { error: 'Email, password, and name are required' },
        { status: 400 }
      );
    }

    const email = rawEmail.trim().toLowerCase();

    // Check if user already exists (case-insensitive for legacy mixed-case emails)
    const existingUser = await prisma.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: 'insensitive',
        },
        ...activeUserWhere,
      },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'User with this email already exists' },
        { status: 400 }
      );
    }

    const terminatedUser = await prisma.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: 'insensitive',
        },
        deactivatedAt: { not: null },
      },
    });

    if (terminatedUser) {
      return NextResponse.json(
        {
          error:
            'A terminated account already exists for this email. Their history is preserved and this email cannot be reused.',
        },
        { status: 400 },
      );
    }

    const roleKey = newUserRole || "DESIGNER";
    if (!(await validateAssignableRole(roleKey))) {
      return NextResponse.json(
        { error: "Invalid role. Choose an active role from the role list." },
        { status: 400 },
      );
    }

    const actor = await getSystemRoleActor(session);
    if (!canActorAssignSystemRole(actor, roleKey)) {
      if (roleKey === SYSTEM_ROLE_KEYS.DEVELOPER) {
        return NextResponse.json(
          { error: 'Only Developers can create users with the Developer role' },
          { status: 403 },
        );
      }
      return NextResponse.json(
        { error: 'Only Super Admins or Developers can create users with the Super Admin role' },
        { status: 403 },
      );
    }

    const roleData = await buildUserUpdateForRole(roleKey);

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: name.trim(),
        ...roleData,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ user });
  } catch (error) {
    console.error('Error creating user:', error);
    return NextResponse.json(
      { error: 'Failed to create user' },
      { status: 500 }
    );
  }
}

