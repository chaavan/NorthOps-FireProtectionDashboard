import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, canEdit, isAdmin, resolveSessionUserRole } from '@/lib/auth';
import { isPermissionKey } from '@/lib/permissionCatalog';
import { hasPermission } from '@/lib/permissions';

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ authorized: false }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action'); // 'edit' or 'admin'
  const permission = searchParams.get('permission');

  const role = (await resolveSessionUserRole(session)) ?? (session.user as any).role;

  let authorized = false;

  if (permission && isPermissionKey(permission)) {
    authorized = await hasPermission(session, permission);
  } else if (action === 'edit') {
    authorized = canEdit(role);
  } else if (action === 'admin') {
    authorized = isAdmin(role);
  } else {
    authorized = true; // Default: can view
  }

  return NextResponse.json({
    authorized,
    role,
    user: {
      name: session.user.name,
      email: session.user.email,
    },
  });
}

