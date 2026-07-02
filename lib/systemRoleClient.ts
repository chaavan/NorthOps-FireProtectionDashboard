export const SYSTEM_ROLE_KEYS = {
  SUPER_ADMIN: "SUPER_ADMIN",
  DEVELOPER: "DEVELOPER",
} as const;

export type SystemRoleActor = {
  isSuperAdmin: boolean;
  isDeveloper: boolean;
};

export function canActorAssignSystemRole(
  actor: SystemRoleActor,
  roleKey: string,
): boolean {
  if (roleKey === SYSTEM_ROLE_KEYS.SUPER_ADMIN) {
    return actor.isSuperAdmin || actor.isDeveloper;
  }
  if (roleKey === SYSTEM_ROLE_KEYS.DEVELOPER) {
    return actor.isDeveloper;
  }
  return true;
}

export function canActorChangeUserRole(
  actor: SystemRoleActor,
  currentRole: string,
  nextRole: string,
): boolean {
  if (currentRole === SYSTEM_ROLE_KEYS.SUPER_ADMIN && nextRole !== SYSTEM_ROLE_KEYS.SUPER_ADMIN) {
    return actor.isSuperAdmin || actor.isDeveloper;
  }
  if (currentRole === SYSTEM_ROLE_KEYS.DEVELOPER && nextRole !== SYSTEM_ROLE_KEYS.DEVELOPER) {
    return actor.isDeveloper;
  }
  if (nextRole === SYSTEM_ROLE_KEYS.SUPER_ADMIN || nextRole === SYSTEM_ROLE_KEYS.DEVELOPER) {
    return canActorAssignSystemRole(actor, nextRole);
  }
  return true;
}

export function isFixedSystemRoleKey(roleKey: string | null | undefined): boolean {
  return roleKey === SYSTEM_ROLE_KEYS.SUPER_ADMIN || roleKey === SYSTEM_ROLE_KEYS.DEVELOPER;
}
