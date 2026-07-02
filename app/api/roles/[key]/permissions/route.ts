import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  PERMISSION_GROUPS,
  PERMISSION_HIERARCHY,
  isPermissionKey,
  type PermissionKey,
} from "@/lib/permissionCatalog";
import { requirePermission, resolvePermissionActorId } from "@/lib/permissions";
import { requireRolePermissionManagementEnabled } from "@/lib/rolePermissionManagementGuard";
import {
  getDashboardRole,
  getRolePermissionTemplate,
  saveRolePermissionTemplate,
} from "@/lib/roleService";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ key: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const feature = requireRolePermissionManagementEnabled();
  if (!feature.ok) return feature.response;

  const session = await getServerSession(authOptions);
  const auth = await requirePermission(session, "users.permissions.edit");
  if (!auth.ok) return auth.response;

  const { key } = await context.params;
  const role = await getDashboardRole(key);
  if (!role) {
    return NextResponse.json({ error: "Role not found" }, { status: 404 });
  }

  const permissions = await getRolePermissionTemplate(key);
  const auditLogs = await prisma.permissionAuditLog.findMany({
    where: {
      permissionKey: key,
      action: {
        in: [
          "ROLE_CREATED",
          "ROLE_UPDATED",
          "ROLE_ARCHIVED",
          "ROLE_RESTORED",
          "ROLE_PERMISSIONS_UPDATED",
        ],
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      action: true,
      permissionKey: true,
      before: true,
      after: true,
      createdAt: true,
      actor: { select: { id: true, email: true, name: true } },
    },
  });

  return NextResponse.json({
    groups: PERMISSION_GROUPS,
    hierarchy: PERMISSION_HIERARCHY,
    role,
    permissions,
    auditLogs,
  });
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const feature = requireRolePermissionManagementEnabled();
  if (!feature.ok) return feature.response;

  const session = await getServerSession(authOptions);
  const auth = await requirePermission(session, "users.permissions.edit");
  if (!auth.ok) return auth.response;

  const { key } = await context.params;
  const body = await request.json();
  const rawPermissions = body?.permissions;

  if (!rawPermissions || typeof rawPermissions !== "object" || Array.isArray(rawPermissions)) {
    return NextResponse.json({ error: "permissions object is required" }, { status: 400 });
  }

  const permissions: Partial<Record<PermissionKey, boolean>> = {};
  for (const [permissionKey, value] of Object.entries(rawPermissions)) {
    if (!isPermissionKey(permissionKey)) {
      return NextResponse.json(
        { error: `Unknown permission key: ${permissionKey}` },
        { status: 400 },
      );
    }
    if (typeof value !== "boolean") {
      return NextResponse.json(
        { error: `Invalid permission value for ${permissionKey}` },
        { status: 400 },
      );
    }
    permissions[permissionKey] = value;
  }

  try {
    const saved = await saveRolePermissionTemplate({
      roleKey: key,
      permissions,
      actorUserId: await resolvePermissionActorId(session),
    });
    const role = await getDashboardRole(key);
    return NextResponse.json({ role, permissions: saved });
  } catch (error) {
    const message = (error as Error).message;
    const status = message === "Role not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
