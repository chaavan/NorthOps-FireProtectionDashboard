import "server-only";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ALL_PERMISSION_KEYS,
  applyRoleLockedPermissions,
  defaultRoleAllows,
  getPermissionRequirements,
  isDeveloperOnlyPermission,
  isPermissionKey,
  type PermissionKey,
} from "@/lib/permissionCatalog";
import {
  JOB_OVERRIDABLE_KEYS,
  mergeJobScopedPermissions,
} from "@/lib/jobPermissionEditorUtils";

export { JOB_OVERRIDABLE_KEYS, mergeJobScopedPermissions };
import { resolvePermissionsFromTemplateAndOverrides } from "@/lib/permissionResolution";
import {
  isDeveloperBootstrapEmail,
  resolveIsDeveloper,
  resolveIsSuperAdmin,
  type SystemRoleActor,
} from "@/lib/systemRoles";
import { normalizeListContextForLookup } from "@/lib/jobListContext";
import { JOB_ACCESS_SOURCES, setJobAccess } from "@/lib/jobAccess";

export { resolvePermissionsFromTemplateAndOverrides } from "@/lib/permissionResolution";

type SessionLike =
  | {
      user?: {
        id?: string | null;
        email?: string | null;
        role?: string | null;
        isDeveloper?: boolean | null;
        isSuperAdmin?: boolean | null;
      } | null;
    }
  | null
  | undefined;

type DbPermissionUser = {
  id: string;
  email: string;
  role: string;
  isSuperAdmin: boolean;
  isDeveloper?: boolean;
};

export type PermissionOverrideState = "DEFAULT" | "ALLOW" | "DENY";

export type EffectivePermissionDetails = {
  permissions: Record<PermissionKey, boolean>;
  template: Record<PermissionKey, boolean>;
  overrides: Partial<Record<PermissionKey, "ALLOW" | "DENY">>;
  isDeveloper: boolean;
  isSuperAdmin: boolean;
  role: string;
};

export function isDeveloperPermissionEmail(email?: string | null): boolean {
  return isDeveloperBootstrapEmail(email);
}

function allPermissions(value: boolean): Record<PermissionKey, boolean> {
  return Object.fromEntries(
    ALL_PERMISSION_KEYS.map((key) => [key, value]),
  ) as Record<PermissionKey, boolean>;
}

function applyDeveloperOnlyPermissions(
  permissions: Record<PermissionKey, boolean>,
  isDeveloper: boolean,
): Record<PermissionKey, boolean> {
  if (isDeveloper) return permissions;
  const next = { ...permissions };
  for (const key of ALL_PERMISSION_KEYS) {
    if (isDeveloperOnlyPermission(key)) next[key] = false;
  }
  return next;
}

async function resolveSessionUser(session: SessionLike): Promise<DbPermissionUser | null> {
  const email = session?.user?.email?.trim().toLowerCase();
  if (email) {
    return prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, email: true, role: true, isSuperAdmin: true, isDeveloper: true },
    });
  }

  const id = session?.user?.id?.trim();
  if (id) {
    return prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true, isSuperAdmin: true, isDeveloper: true },
    });
  }

  return null;
}

async function templateAllowsForRole(role: string): Promise<Record<PermissionKey, boolean>> {
  const rows = await prisma.rolePermissionTemplate.findMany({
    where: { role },
    select: { permissionKey: true, effect: true },
  });

  if (rows.length > 0) {
    const template = allPermissions(false);
    const keysInDb = new Set<string>();
    for (const row of rows) {
      keysInDb.add(row.permissionKey);
      if (isPermissionKey(row.permissionKey)) {
        template[row.permissionKey] = row.effect === "ALLOW";
      }
    }
    for (const key of defaultRoleAllows(role)) {
      if (!keysInDb.has(key)) template[key] = true;
    }
    return applyDeveloperOnlyPermissions(applyRoleLockedPermissions(template), false);
  }

  const template = allPermissions(false);
  for (const key of defaultRoleAllows(role)) template[key] = true;
  return applyDeveloperOnlyPermissions(applyRoleLockedPermissions(template), false);
}

export async function getEffectivePermissionsForUser(
  user: DbPermissionUser,
): Promise<EffectivePermissionDetails> {
  const isDeveloper = resolveIsDeveloper(user);
  const isSuperAdmin = resolveIsSuperAdmin(user);
  const template = await templateAllowsForRole(user.role);
  const overrides: Partial<Record<PermissionKey, "ALLOW" | "DENY">> = {};

  const rows = await prisma.permissionOverride.findMany({
    where: { userId: user.id },
    select: { permissionKey: true, effect: true },
  });

  for (const row of rows) {
    if (isPermissionKey(row.permissionKey)) {
      overrides[row.permissionKey] = row.effect;
    }
  }

  if (isDeveloper && !isSuperAdmin) {
    return {
      permissions: allPermissions(true),
      template,
      overrides,
      isDeveloper,
      isSuperAdmin: false,
      role: user.role,
    };
  }

  if (isSuperAdmin) {
    return {
      permissions: applyDeveloperOnlyPermissions(allPermissions(true), false),
      template,
      overrides,
      isDeveloper,
      isSuperAdmin: true,
      role: user.role,
    };
  }

  const permissions = applyDeveloperOnlyPermissions(
    resolvePermissionsFromTemplateAndOverrides(template, overrides, {
      isDeveloper: false,
      isSuperAdmin: false,
    }),
    false,
  );

  return {
    permissions,
    template,
    overrides,
    isDeveloper,
    isSuperAdmin: false,
    role: user.role,
  };
}

export async function getEffectivePermissionsForUserId(
  userId: string,
): Promise<EffectivePermissionDetails | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, isSuperAdmin: true, isDeveloper: true },
  });
  if (!user) return null;
  return getEffectivePermissionsForUser(user);
}

export async function getEffectivePermissionsForSession(
  session: SessionLike,
): Promise<EffectivePermissionDetails | null> {
  const user = await resolveSessionUser(session);
  if (!user) return null;
  return getEffectivePermissionsForUser(user);
}

export async function getJobPermissionOverrides(
  userEmail: string,
  jobNumber: string,
  listNumber: string,
): Promise<Partial<Record<PermissionKey, "ALLOW" | "DENY">>> {
  const rows = await prisma.jobPermissionOverride.findMany({
    where: {
      jobNumber: jobNumber.trim(),
      listNumber,
      userEmail: userEmail.trim().toLowerCase(),
    },
    select: { permissionKey: true, effect: true },
  });

  const overrides: Partial<Record<PermissionKey, "ALLOW" | "DENY">> = {};
  for (const row of rows) {
    if (isPermissionKey(row.permissionKey)) {
      overrides[row.permissionKey] = row.effect;
    }
  }
  return overrides;
}

/**
 * Adds the job creator to the access list with a CREATOR source tag.
 * Capability on the job follows their normal role permissions and any
 * explicit per-job overrides — same as any other access-list member.
 */
export async function grantCreatorJobAccess(
  jobNumber: string,
  userEmail: string,
  listNumberContext?: string | null,
): Promise<void> {
  await setJobAccess(
    jobNumber.trim(),
    userEmail.trim().toLowerCase(),
    listNumberContext,
    JOB_ACCESS_SOURCES.CREATOR,
  );
}

export type PermissionContext = {
  jobNumber?: string | null;
  listNumber?: string | null;
};

export async function hasPermission(
  session: SessionLike,
  key: PermissionKey,
  context?: PermissionContext,
): Promise<boolean> {
  const details = await getEffectivePermissionsForSession(session);
  if (!details) return false;
  if (isDeveloperOnlyPermission(key)) return details.isDeveloper;
  if (details.isDeveloper || details.isSuperAdmin) return true;

  if (context?.jobNumber && JOB_OVERRIDABLE_KEYS.has(key)) {
    const userEmail = session?.user?.email?.trim().toLowerCase();
    if (userEmail) {
      const listNumber = normalizeListContextForLookup(context.listNumber);
      const overrides = await getJobPermissionOverrides(userEmail, context.jobNumber, listNumber);
      const scoped = (k: PermissionKey): boolean =>
        JOB_OVERRIDABLE_KEYS.has(k) && overrides[k]
          ? overrides[k] === "ALLOW"
          : details.permissions[k] === true;
      return scoped(key) && getPermissionRequirements(key).every(scoped);
    }
  }

  return details.permissions[key] === true;
}

export async function requirePermission(
  session: SessionLike,
  key: PermissionKey,
  context?: PermissionContext,
): Promise<
  | { ok: true }
  | { ok: false; response: NextResponse<{ error: string }> }
> {
  if (!session?.user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Unauthorized - Please sign in" },
        { status: 401 },
      ),
    };
  }

  if (!(await hasPermission(session, key, context))) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden - Permission required", permission: key } as any,
        { status: 403 },
      ),
    };
  }

  return { ok: true };
}

export async function canManagePermissions(session: SessionLike): Promise<boolean> {
  return hasPermission(session, "users.permissions.edit");
}

export async function resolvePermissionActorId(session: SessionLike): Promise<string | null> {
  const user = await resolveSessionUser(session);
  return user?.id ?? null;
}

/** Super Admin accounts can only be modified by Super Admins or Developers. */
export async function requireSuperAdminActorForTargetSuperAdmin(
  session: SessionLike,
  target: DbPermissionUser,
): Promise<
  | { ok: true }
  | { ok: false; response: NextResponse<{ error: string }> }
> {
  const targetDetails = await getEffectivePermissionsForUser(target);
  if (!targetDetails.isSuperAdmin) {
    return { ok: true };
  }

  const actorDetails = await getEffectivePermissionsForSession(session);
  if (!actorDetails?.isSuperAdmin && !actorDetails?.isDeveloper) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "Only Super Admins or Developers can terminate or modify access for other Super Admins",
        },
        { status: 403 },
      ),
    };
  }

  return { ok: true };
}

/** Developer accounts can only be modified by Developers. */
export async function requireDeveloperActorForTargetDeveloper(
  session: SessionLike,
  target: DbPermissionUser,
): Promise<
  | { ok: true }
  | { ok: false; response: NextResponse<{ error: string }> }
> {
  const targetDetails = await getEffectivePermissionsForUser(target);
  if (!targetDetails.isDeveloper) {
    return { ok: true };
  }

  const actorDetails = await getEffectivePermissionsForSession(session);
  if (!actorDetails?.isDeveloper) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Only Developers can terminate or modify access for other Developers",
        },
        { status: 403 },
      ),
    };
  }

  return { ok: true };
}

export async function getSystemRoleActor(session: SessionLike): Promise<SystemRoleActor> {
  const details = await getEffectivePermissionsForSession(session);
  return {
    isSuperAdmin: details?.isSuperAdmin === true,
    isDeveloper: details?.isDeveloper === true,
  };
}
