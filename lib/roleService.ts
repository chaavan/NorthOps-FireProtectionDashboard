import "server-only";

import { prisma } from "@/lib/prisma";
import {
  ALL_PERMISSION_KEYS,
  applyRoleLockedPermissions,
  isPermissionKey,
  isDeveloperOnlyPermission,
  isRoleLockedPermission,
  type PermissionKey,
} from "@/lib/permissionCatalog";
import {
  DEFAULT_ROLE_BADGE_CLASS,
  isColorTaken,
  isValidRoleBadgeColor,
  roleColorToHex,
} from "@/lib/roleBadgeColor";
import { isFixedSystemRoleKey } from "@/lib/systemRoleClient";

export type DashboardRoleRecord = {
  key: string;
  name: string;
  description: string | null;
  colorClass: string | null;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
  userCount?: number;
  createdAt: string;
  updatedAt: string;
};

const RESERVED_ROLE_KEYS = new Set([
  "ADMIN",
  "PROJECT_MANAGER",
  "DESIGNER",
  "SALES",
  "EDITOR",
  "VIEWER",
]);

function serializeRole(
  role: {
    key: string;
    name: string;
    description: string | null;
    colorClass: string | null;
    isSystem: boolean;
    isActive: boolean;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  },
  userCount?: number,
): DashboardRoleRecord {
  return {
    key: role.key,
    name: role.name,
    description: role.description,
    colorClass: role.colorClass,
    isSystem: role.isSystem,
    isActive: role.isActive,
    sortOrder: role.sortOrder,
    userCount,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  };
}

async function assertUniqueBadgeColor(colorClass: string | null | undefined, excludeKey?: string) {
  const value = colorClass?.trim() || DEFAULT_ROLE_BADGE_CLASS;
  if (!isValidRoleBadgeColor(value)) {
    throw new Error("Invalid badge color.");
  }

  const roles = await prisma.dashboardRole.findMany({
    select: { key: true, name: true, colorClass: true },
  });
  const hex = roleColorToHex(value);
  const collision = isColorTaken(hex, roles, excludeKey);
  if (collision.taken) {
    throw new Error(`Badge color is already used by ${collision.owner?.name}.`);
  }
}

async function writeRoleAudit(params: {
  actorUserId: string | null;
  roleKey: string;
  action: string;
  permissionKey?: string | null;
  before?: unknown;
  after?: unknown;
}) {
  await prisma.permissionAuditLog.create({
    data: {
      actorUserId: params.actorUserId,
      targetUserId: null,
      action: params.action,
      permissionKey: params.permissionKey ?? params.roleKey,
      before: params.before as object | undefined,
      after: params.after as object | undefined,
    },
  });
}

async function generateRoleKey(name: string): Promise<string> {
  let base = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!base) base = "CUSTOM_ROLE";
  if (!base.startsWith("CUSTOM_") && RESERVED_ROLE_KEYS.has(base)) {
    base = `CUSTOM_${base}`;
  }

  let candidate = base;
  let counter = 2;
  while (await prisma.dashboardRole.findUnique({ where: { key: candidate } })) {
    candidate = `${base}_${counter}`;
    counter += 1;
  }
  return candidate;
}

export async function listDashboardRoles(options?: {
  includeArchived?: boolean;
  includeUserCounts?: boolean;
}): Promise<DashboardRoleRecord[]> {
  const roles = await prisma.dashboardRole.findMany({
    where: options?.includeArchived ? undefined : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  if (!options?.includeUserCounts) {
    return roles.map((role) => serializeRole(role));
  }

  const counts = await prisma.user.groupBy({
    by: ["role"],
    _count: { role: true },
    where: { deactivatedAt: null },
  });
  const countByRole = new Map(counts.map((entry) => [entry.role, entry._count.role]));

  return roles.map((role) => serializeRole(role, countByRole.get(role.key) ?? 0));
}

export async function getDashboardRole(key: string): Promise<DashboardRoleRecord | null> {
  const role = await prisma.dashboardRole.findUnique({ where: { key } });
  if (!role) return null;

  const userCount = await prisma.user.count({
    where: { role: key, deactivatedAt: null },
  });
  return serializeRole(role, userCount);
}

export async function validateAssignableRole(roleKey: string): Promise<boolean> {
  const role = await prisma.dashboardRole.findUnique({
    where: { key: roleKey },
    select: { isActive: true },
  });
  return role?.isActive === true;
}

export async function createDashboardRole(params: {
  name: string;
  description?: string | null;
  colorClass?: string | null;
  actorUserId: string | null;
}): Promise<DashboardRoleRecord> {
  const name = params.name.trim();
  if (!name) {
    throw new Error("Role name is required.");
  }

  const key = await generateRoleKey(name);
  const maxSort = await prisma.dashboardRole.aggregate({ _max: { sortOrder: true } });
  const nextColorClass = params.colorClass?.trim() || DEFAULT_ROLE_BADGE_CLASS;
  await assertUniqueBadgeColor(nextColorClass);

  const role = await prisma.$transaction(async (tx) => {
    const created = await tx.dashboardRole.create({
      data: {
        key,
        name,
        description: params.description?.trim() || null,
        colorClass: nextColorClass,
        isSystem: false,
        isActive: true,
        sortOrder: (maxSort._max.sortOrder ?? 100) + 10,
        createdByUserId: params.actorUserId,
        updatedByUserId: params.actorUserId,
      },
    });

    await tx.rolePermissionTemplate.createMany({
      data: ALL_PERMISSION_KEYS.map((permissionKey) => ({
        role: key,
        permissionKey,
        effect: "DENY" as const,
      })),
      skipDuplicates: true,
    });

    return created;
  });

  await writeRoleAudit({
    actorUserId: params.actorUserId,
    roleKey: role.key,
    action: "ROLE_CREATED",
    after: {
      key: role.key,
      name: role.name,
      description: role.description,
      colorClass: role.colorClass,
    },
  });

  return serializeRole(role, 0);
}

export async function updateDashboardRole(params: {
  key: string;
  name?: string;
  description?: string | null;
  colorClass?: string | null;
  isActive?: boolean;
  actorUserId: string | null;
}): Promise<DashboardRoleRecord> {
  const existing = await prisma.dashboardRole.findUnique({ where: { key: params.key } });
  if (!existing) {
    throw new Error("Role not found.");
  }

  if (params.isActive === false && existing.isSystem) {
    throw new Error("System roles cannot be archived.");
  }

  const nextName = params.name !== undefined ? params.name.trim() : existing.name;
  if (!nextName) {
    throw new Error("Role name is required.");
  }

  const nextColorClass =
    params.colorClass !== undefined ? params.colorClass?.trim() || null : existing.colorClass;
  if (params.colorClass !== undefined) {
    await assertUniqueBadgeColor(nextColorClass, params.key);
  }

  const updated = await prisma.dashboardRole.update({
    where: { key: params.key },
    data: {
      name: nextName,
      description:
        params.description !== undefined
          ? params.description?.trim() || null
          : existing.description,
      colorClass: nextColorClass,
      isActive: params.isActive !== undefined ? params.isActive : existing.isActive,
      updatedByUserId: params.actorUserId,
    },
  });

  const action =
    params.isActive === false && existing.isActive
      ? "ROLE_ARCHIVED"
      : params.isActive === true && !existing.isActive
        ? "ROLE_RESTORED"
        : "ROLE_UPDATED";

  await writeRoleAudit({
    actorUserId: params.actorUserId,
    roleKey: updated.key,
    action,
    before: {
      name: existing.name,
      description: existing.description,
      colorClass: existing.colorClass,
      isActive: existing.isActive,
    },
    after: {
      name: updated.name,
      description: updated.description,
      colorClass: updated.colorClass,
      isActive: updated.isActive,
    },
  });

  const userCount = await prisma.user.count({
    where: { role: updated.key, deactivatedAt: null },
  });
  return serializeRole(updated, userCount);
}

export async function getRolePermissionTemplate(
  roleKey: string,
): Promise<Record<PermissionKey, boolean>> {
  const role = await prisma.dashboardRole.findUnique({ where: { key: roleKey } });
  if (!role) {
    throw new Error("Role not found.");
  }

  const rows = await prisma.rolePermissionTemplate.findMany({
    where: { role: roleKey },
    select: { permissionKey: true, effect: true },
  });

  const template = Object.fromEntries(
    ALL_PERMISSION_KEYS.map((key) => [key, false]),
  ) as Record<PermissionKey, boolean>;

  for (const row of rows) {
    if (isPermissionKey(row.permissionKey)) {
      template[row.permissionKey] = row.effect === "ALLOW";
    }
  }

  for (const key of ALL_PERMISSION_KEYS) {
    if (isDeveloperOnlyPermission(key)) template[key] = false;
  }

  return applyRoleLockedPermissions(template);
}

export async function saveRolePermissionTemplate(params: {
  roleKey: string;
  permissions: Partial<Record<PermissionKey, boolean>>;
  actorUserId: string | null;
}): Promise<Record<PermissionKey, boolean>> {
  if (isFixedSystemRoleKey(params.roleKey)) {
    throw new Error("Super Admin and Developer permissions are fixed system roles.");
  }

  const role = await prisma.dashboardRole.findUnique({ where: { key: params.roleKey } });
  if (!role) {
    throw new Error("Role not found.");
  }

  const before = await getRolePermissionTemplate(params.roleKey);
  const changes: Array<{ permissionKey: PermissionKey; before: boolean; after: boolean }> = [];

  await prisma.$transaction(async (tx) => {
    for (const permissionKey of ALL_PERMISSION_KEYS) {
      if (isDeveloperOnlyPermission(permissionKey)) continue;
      if (isRoleLockedPermission(permissionKey)) continue;
      if (!(permissionKey in params.permissions)) continue;
      const allowed = Boolean(params.permissions[permissionKey]);
      const effect = allowed ? "ALLOW" : "DENY";
      if (before[permissionKey] === allowed) continue;

      changes.push({
        permissionKey,
        before: before[permissionKey],
        after: allowed,
      });

      await tx.rolePermissionTemplate.upsert({
        where: {
          role_permissionKey: {
            role: params.roleKey,
            permissionKey,
          },
        },
        update: { effect },
        create: {
          role: params.roleKey,
          permissionKey,
          effect,
        },
      });
    }
  });

  const after = await getRolePermissionTemplate(params.roleKey);

  if (changes.length > 0) {
    await writeRoleAudit({
      actorUserId: params.actorUserId,
      roleKey: params.roleKey,
      action: "ROLE_PERMISSIONS_UPDATED",
      before: { permissions: Object.fromEntries(changes.map((c) => [c.permissionKey, c.before])) },
      after: { permissions: Object.fromEntries(changes.map((c) => [c.permissionKey, c.after])) },
    });
  }

  return after;
}
