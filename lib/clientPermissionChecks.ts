import type { PermissionKey } from "@/lib/permissionCatalog";
import { isDeveloperOnlyPermission } from "@/lib/permissionCatalog";
import { SYSTEM_ROLE_KEYS } from "@/lib/systemRoleClient";

export type ClientPermissionActor = {
  role?: string | null;
  isSuperAdmin?: boolean;
  isDeveloper?: boolean;
};

export type ClientPermissionState = {
  permissions: Partial<Record<PermissionKey, boolean>>;
  isDeveloper: boolean;
  isSuperAdmin: boolean;
};

/** True for Admin, Super Admin, or Developer (survey/dev tools still gated separately). */
export function hasClientElevatedAccess(actor: ClientPermissionActor): boolean {
  const role = actor.role;
  return (
    role === "ADMIN" ||
    role === SYSTEM_ROLE_KEYS.SUPER_ADMIN ||
    role === SYSTEM_ROLE_KEYS.DEVELOPER ||
    actor.isSuperAdmin === true ||
    actor.isDeveloper === true
  );
}

/** Mirrors server hasPermission() for client-side permission maps. */
export function evaluateClientPermission(
  key: PermissionKey,
  state: ClientPermissionState,
): boolean {
  if (isDeveloperOnlyPermission(key)) return state.isDeveloper;
  if (state.isDeveloper || state.isSuperAdmin) return true;
  return state.permissions[key] === true;
}

/** Optimistic allow while permissions are loading for elevated users. */
export function permissionLoadingFallback(actor: ClientPermissionActor): boolean {
  return hasClientElevatedAccess(actor);
}
