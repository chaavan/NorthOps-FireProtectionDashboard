import "server-only";

import {
  SYSTEM_ROLE_KEYS,
  type SystemRoleActor,
  canActorAssignSystemRole,
  canActorChangeUserRole,
  isFixedSystemRoleKey,
} from "@/lib/systemRoleClient";

export {
  SYSTEM_ROLE_KEYS,
  type SystemRoleActor,
  canActorAssignSystemRole,
  canActorChangeUserRole,
  isFixedSystemRoleKey,
} from "@/lib/systemRoleClient";

export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[keyof typeof SYSTEM_ROLE_KEYS];

const SYSTEM_ROLE_KEY_SET = new Set<string>(Object.values(SYSTEM_ROLE_KEYS));

export function isSystemRoleKey(roleKey: string | null | undefined): roleKey is SystemRoleKey {
  return !!roleKey && SYSTEM_ROLE_KEY_SET.has(roleKey);
}

export function isSuperAdminRoleKey(roleKey: string | null | undefined): boolean {
  return roleKey === SYSTEM_ROLE_KEYS.SUPER_ADMIN;
}

export function isDeveloperRoleKey(roleKey: string | null | undefined): boolean {
  return roleKey === SYSTEM_ROLE_KEYS.DEVELOPER;
}

export function flagsForSystemRole(roleKey: string): {
  isSuperAdmin: boolean;
  isDeveloper: boolean;
} {
  if (roleKey === SYSTEM_ROLE_KEYS.SUPER_ADMIN) {
    return { isSuperAdmin: true, isDeveloper: false };
  }
  if (roleKey === SYSTEM_ROLE_KEYS.DEVELOPER) {
    return { isSuperAdmin: false, isDeveloper: true };
  }
  return { isSuperAdmin: false, isDeveloper: false };
}

export function isDeveloperBootstrapEmail(email?: string | null): boolean {
  return new Set(
    (process.env.DEVELOPER_EMAILS || "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  ).has(email?.trim().toLowerCase() ?? "");
}

export type SystemRoleUserLike = {
  email: string;
  role: string;
  isSuperAdmin?: boolean;
  isDeveloper?: boolean;
};

export function resolveIsDeveloper(user: SystemRoleUserLike): boolean {
  if (isDeveloperRoleKey(user.role)) return true;
  if (user.isDeveloper === true) return true;
  return isDeveloperBootstrapEmail(user.email);
}

export function resolveIsSuperAdmin(user: SystemRoleUserLike): boolean {
  if (isSuperAdminRoleKey(user.role)) return true;
  if (resolveIsDeveloper(user) && !isSuperAdminRoleKey(user.role)) return false;
  return user.isSuperAdmin === true;
}

export function userDataForRole(roleKey: string): {
  role: string;
  isSuperAdmin: boolean;
  isDeveloper: boolean;
} {
  const flags = flagsForSystemRole(roleKey);
  return {
    role: roleKey,
    isSuperAdmin: flags.isSuperAdmin,
    isDeveloper: flags.isDeveloper,
  };
}
