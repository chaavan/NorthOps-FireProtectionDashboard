import {
  ALL_PERMISSION_KEYS,
  AUTO_ADD_JOB_ACCESS_KEY,
  applyImpliedPermissions,
  canUseAutoAddJobAccess,
  getPermissionRequirements,
  isDeveloperOnlyPermission,
  isPermissionKey,
  type PermissionKey,
} from "@/lib/permissionCatalog";

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

export function applyPermissionRequirements(
  permissions: Record<PermissionKey, boolean>,
): Record<PermissionKey, boolean> {
  let next = applyImpliedPermissions({ ...permissions });
  for (const key of ALL_PERMISSION_KEYS) {
    if (next[key] !== true) continue;
    const requirements = getPermissionRequirements(key);
    if (requirements.some((requiredKey) => next[requiredKey] !== true)) {
      next[key] = false;
    }
  }
  if (
    next[AUTO_ADD_JOB_ACCESS_KEY] === true &&
    !canUseAutoAddJobAccess(next)
  ) {
    next[AUTO_ADD_JOB_ACCESS_KEY] = false;
  }
  return applyImpliedPermissions(next);
}

export function resolvePermissionsFromTemplateAndOverrides(
  template: Record<PermissionKey, boolean>,
  overrides: Partial<Record<PermissionKey, "ALLOW" | "DENY">>,
  options?: { isSuperAdmin?: boolean; isDeveloper?: boolean },
): Record<PermissionKey, boolean> {
  if (options?.isDeveloper && !options?.isSuperAdmin) {
    return allPermissions(true);
  }

  if (options?.isSuperAdmin) {
    return applyDeveloperOnlyPermissions(allPermissions(true), false);
  }

  const permissions = { ...template };
  for (const [key, effect] of Object.entries(overrides)) {
    if (isPermissionKey(key)) {
      permissions[key] = effect === "ALLOW";
    }
  }
  return applyPermissionRequirements(applyDeveloperOnlyPermissions(permissions, false));
}
