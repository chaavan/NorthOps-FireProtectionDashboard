import { prisma } from '@/lib/prisma';
import { JOB_ACCESS_SOURCES, setJobAccess } from '@/lib/jobAccess';
import { isAdmin } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { normalizeListContextForLookup } from '@/lib/jobListContext';
import { sendJobAccessAddedNotification } from '@/lib/notifications';

export class InitialJobAccessGrantsError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'InitialJobAccessGrantsError';
  }
}

export type ResolvedInitialAccessGrant = {
  canonicalEmail: string;
};

/**
 * Validate accessGrants from the request body, resolve users, dedupe,
 * and drop the creator (they already get CREATOR access on create). Granted
 * users get gatekeeping access only — capability defaults to their normal
 * role permissions, overridable later via the job's "Manage permissions"
 * action. Call before creating the job so a bad email does not leave an
 * orphan job.
 */
export async function resolveInitialAccessGrantsFromBody(
  raw: unknown,
  creatorEmail: string | null | undefined,
): Promise<ResolvedInitialAccessGrant[]> {
  if (raw == null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new InitialJobAccessGrantsError(400, 'accessGrants must be an array when provided');
  }

  const creatorLower = creatorEmail?.trim().toLowerCase() ?? null;

  const byLowerEmail = new Map<string, string>();

  for (const entry of raw) {
    if (entry == null || typeof entry !== 'object') {
      continue;
    }
    const userEmail = (entry as { userEmail?: unknown }).userEmail;
    const e = typeof userEmail === 'string' ? userEmail.trim() : '';
    if (!e) {
      continue;
    }
    byLowerEmail.set(e.toLowerCase(), e);
  }

  const resolved: ResolvedInitialAccessGrant[] = [];

  for (const [lower, rawInputEmail] of byLowerEmail) {
    if (creatorLower && lower === creatorLower) {
      continue;
    }

    const targetUser = await prisma.user.findFirst({
      where: { email: { equals: rawInputEmail, mode: 'insensitive' } },
      select: { email: true },
    });

    if (!targetUser) {
      throw new InitialJobAccessGrantsError(404, `User not found: ${rawInputEmail}`);
    }

    resolved.push({
      canonicalEmail: targetUser.email.trim().toLowerCase(),
    });
  }

  return resolved;
}

/**
 * After creator JobAccess exists: enforce can-manage-access, upsert grants,
 * send access-added webhook only for users who did not already have access on this list.
 */
export async function applyResolvedInitialAccessGrants(params: {
  jobNumber: string;
  listNumber: string;
  creatorEmail: string | null | undefined;
  grants: ResolvedInitialAccessGrant[];
  grantedByEmail: string;
  grantedByRole: string | null | undefined;
}): Promise<void> {
  const {
    jobNumber,
    listNumber,
    creatorEmail,
    grants,
    grantedByEmail,
    grantedByRole,
  } = params;

  if (grants.length === 0) {
    return;
  }

  const normalizedJobNumber = jobNumber.trim();
  const normalizedList = normalizeListContextForLookup(listNumber);

  const creatorLower = creatorEmail?.trim().toLowerCase() ?? null;
  const nonCreator = grants.filter((g) => g.canonicalEmail !== creatorLower);
  if (nonCreator.length === 0) {
    return;
  }

  const canManage =
    isAdmin(grantedByRole) ||
    (await hasPermission(
      { user: { email: grantedByEmail, role: grantedByRole } },
      'job.access.manage',
      { jobNumber: normalizedJobNumber, listNumber: normalizedList },
    ));
  if (!canManage) {
    throw new InitialJobAccessGrantsError(
      403,
      'Forbidden - You do not have permission to add people to this job',
    );
  }

  for (const { canonicalEmail } of nonCreator) {
    const hadAccess = await prisma.jobAccess.findUnique({
      where: {
        jobNumber_listNumber_userEmail: {
          jobNumber: normalizedJobNumber,
          listNumber: normalizedList,
          userEmail: canonicalEmail,
        },
      },
    });

    await setJobAccess(
      normalizedJobNumber,
      canonicalEmail,
      normalizedList,
      JOB_ACCESS_SOURCES.INITIAL_GRANT,
    );

    if (!hadAccess) {
      await sendJobAccessAddedNotification(
        normalizedJobNumber,
        canonicalEmail,
        grantedByEmail,
        grantedByRole ?? undefined,
        new Date(),
        normalizedList,
      ).catch((err) => {
        console.error('[applyResolvedInitialAccessGrants] access-added notification:', err);
      });
    }
  }
}

export function isInitialJobAccessGrantsError(
  e: unknown,
): e is InitialJobAccessGrantsError {
  return e instanceof InitialJobAccessGrantsError;
}
