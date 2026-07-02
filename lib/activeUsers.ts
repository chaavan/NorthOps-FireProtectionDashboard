/** Prisma filter for users who can still sign in and receive access. */
export const activeUserWhere = { deactivatedAt: null } as const;

export function isUserDeactivated(
  user: { deactivatedAt: Date | null } | null | undefined,
): boolean {
  return Boolean(user?.deactivatedAt);
}
