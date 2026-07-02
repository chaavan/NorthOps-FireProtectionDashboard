import "server-only";

import { prisma } from "@/lib/prisma";
import {
  isDeveloperBootstrapEmail,
  isSuperAdminRoleKey,
  SYSTEM_ROLE_KEYS,
  userDataForRole,
} from "@/lib/systemRoles";

/**
 * Keep DEVELOPER_EMAILS bootstrap accounts aligned with the Developer system role.
 * Super Admins are never downgraded by env bootstrap.
 */
export async function syncDeveloperBootstrapForUser(user: {
  id: string;
  email: string;
  role: string;
  isSuperAdmin: boolean;
  isDeveloper: boolean;
}): Promise<{
  role: string;
  isSuperAdmin: boolean;
  isDeveloper: boolean;
} | null> {
  if (!isDeveloperBootstrapEmail(user.email)) return null;
  if (isSuperAdminRoleKey(user.role) || user.isSuperAdmin) return null;

  const next = userDataForRole(SYSTEM_ROLE_KEYS.DEVELOPER);
  if (user.role === next.role && user.isDeveloper === next.isDeveloper && user.isSuperAdmin === next.isSuperAdmin) {
    return null;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: next,
  });

  return next;
}

export async function buildUserUpdateForRole(roleKey: string): Promise<{
  role: string;
  isSuperAdmin: boolean;
  isDeveloper: boolean;
}> {
  return userDataForRole(roleKey);
}
