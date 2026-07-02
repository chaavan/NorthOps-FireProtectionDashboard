import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { activeUserWhere } from "@/lib/activeUsers";
import { prisma } from "@/lib/prisma";
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_HIERARCHY,
  PERMISSION_GROUPS,
  isDeveloperOnlyPermission,
  isPermissionKey,
  type PermissionKey,
} from "@/lib/permissionCatalog";
import {
  getEffectivePermissionsForUser,
  requirePermission,
  resolvePermissionActorId,
  type PermissionOverrideState,
} from "@/lib/permissions";
import { isFixedSystemRoleKey, resolveIsDeveloper } from "@/lib/systemRoles";
import { requireRolePermissionManagementEnabled } from "@/lib/rolePermissionManagementGuard";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function normalizeOverrideState(value: unknown): PermissionOverrideState | null {
  if (value === "DEFAULT" || value === "ALLOW" || value === "DENY") {
    return value;
  }
  return null;
}

async function getTargetUser(id: string) {
  return prisma.user.findFirst({
    where: { id, ...activeUserWhere },
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
  });
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const feature = requireRolePermissionManagementEnabled();
  if (!feature.ok) return feature.response;

  const session = await getServerSession(authOptions);
  const auth = await requirePermission(session, "users.permissions.edit");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const target = await getTargetUser(id);
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const details = await getEffectivePermissionsForUser(target);
  const auditLogs = await prisma.permissionAuditLog.findMany({
    where: { targetUserId: target.id },
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
    user: {
      id: target.id,
      email: target.email,
      name: target.name,
      role: target.role,
      isDeveloper: resolveIsDeveloper(target),
      isSuperAdmin: details.isSuperAdmin,
    },
    ...details,
    auditLogs,
  });
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const feature = requireRolePermissionManagementEnabled();
  if (!feature.ok) return feature.response;

  const session = await getServerSession(authOptions);
  const auth = await requirePermission(session, "users.permissions.edit");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const target = await getTargetUser(id);
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const body = await request.json();
  const rawOverrides = body?.overrides;

  if (isFixedSystemRoleKey(target.role)) {
    return NextResponse.json(
      { error: "Super Admin and Developer permissions are fixed. Change the user's role instead." },
      { status: 400 },
    );
  }

  const actorUserId = await resolvePermissionActorId(session);
  const before = await getEffectivePermissionsForUser(target);

  // User permission saves only touch PermissionOverride rows for target.id and
  // optionally User.isSuperAdmin on target.id — never rolePermissionTemplate.
  const overrideEntries: Array<[PermissionKey, PermissionOverrideState]> = [];

  if (rawOverrides && typeof rawOverrides === "object" && !Array.isArray(rawOverrides)) {
    for (const [key, value] of Object.entries(rawOverrides)) {
      if (!isPermissionKey(key)) {
        return NextResponse.json(
          { error: `Unknown permission key: ${key}` },
          { status: 400 },
        );
      }
      if (isDeveloperOnlyPermission(key)) {
        return NextResponse.json(
          { error: `${key} is controlled by DEVELOPER_EMAILS and cannot be assigned.` },
          { status: 400 },
        );
      }
      const state = normalizeOverrideState(value);
      if (!state) {
        return NextResponse.json(
          { error: `Invalid override state for ${key}` },
          { status: 400 },
        );
      }
      overrideEntries.push([key, state]);
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const [permissionKey, state] of overrideEntries) {
      const previous = before.overrides[permissionKey] ?? "DEFAULT";
      if (previous === state) continue;

      if (state === "DEFAULT") {
        await tx.permissionOverride.deleteMany({
          where: { userId: target.id, permissionKey },
        });
      } else {
        await tx.permissionOverride.upsert({
          where: {
            userId_permissionKey: {
              userId: target.id,
              permissionKey,
            },
          },
          update: {
            effect: state,
            changedByUserId: actorUserId,
          },
          create: {
            userId: target.id,
            permissionKey,
            effect: state,
            changedByUserId: actorUserId,
          },
        });
      }

      await tx.permissionAuditLog.create({
        data: {
          actorUserId,
          targetUserId: target.id,
          action: "PERMISSION_OVERRIDE_UPDATED",
          permissionKey,
          before: { effect: previous },
          after: { effect: state },
        },
      });
    }
  });

  const refreshed = await getTargetUser(id);
  if (!refreshed) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const details = await getEffectivePermissionsForUser(refreshed);

  return NextResponse.json({
    groups: PERMISSION_GROUPS,
    hierarchy: PERMISSION_HIERARCHY,
    user: {
      id: refreshed.id,
      email: refreshed.email,
      name: refreshed.name,
      role: refreshed.role,
      isDeveloper: resolveIsDeveloper(refreshed),
      isSuperAdmin: details.isSuperAdmin,
    },
    knownPermissionKeys: ALL_PERMISSION_KEYS,
    ...details,
  });
}
