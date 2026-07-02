import { canAccessJob, jobHasAccessRecords } from '@/lib/jobAccess';
import { getEffectivePermissionsForSession, hasPermission } from '@/lib/permissions';
import { bypassesJobAccessList } from '@/lib/jobScopedAccess';

type SessionLike =
  | {
      user?: {
        role?: string | null;
        email?: string | null;
      } | null;
    }
  | null
  | undefined;

async function canViewJobImportHistory(
  session: SessionLike,
  jobNumber: string,
  listNumberContext?: string | null,
): Promise<boolean> {
  const context = { jobNumber, listNumber: listNumberContext };
  return (
    (await hasPermission(session, 'job.notes.view', context)) ||
    (await hasPermission(session, 'job.puller.import_update_pdf', context))
  );
}

export async function ensureJobImportReadAccess(params: {
  session: SessionLike;
  jobNumber: string;
  listNumberContext?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const { session, jobNumber, listNumberContext } = params;
  const role = session?.user?.role || undefined;

  if (!session?.user) {
    return { ok: false, error: 'Unauthorized - Please sign in', status: 401 };
  }

  const permissionDetails = await getEffectivePermissionsForSession(session);
  if (bypassesJobAccessList(role, permissionDetails)) {
    return { ok: true };
  }

  if (!(await canViewJobImportHistory(session, jobNumber, listNumberContext))) {
    return { ok: false, error: 'Forbidden - You do not have permission to view this job', status: 403 };
  }

  const userEmail = String(session.user.email || '').trim().toLowerCase();
  if (!userEmail) {
    return { ok: false, error: 'Forbidden - Missing user email', status: 403 };
  }

  const hasRecords = await jobHasAccessRecords(jobNumber, listNumberContext);
  if (hasRecords) {
    const hasAccess = await canAccessJob(userEmail, jobNumber, listNumberContext);
    if (!hasAccess) {
      return { ok: false, error: 'Forbidden - You do not have access to this job', status: 403 };
    }
  }
  // No access records means the job is open - fall through and allow.

  return { ok: true };
}

export async function ensureJobImportWriteAccess(params: {
  session: SessionLike;
  jobNumber: string;
  listNumberContext?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const { session, jobNumber, listNumberContext } = params;
  const role = session?.user?.role || undefined;

  if (!session?.user) {
    return { ok: false, error: 'Unauthorized - Please sign in', status: 401 };
  }

  const permissionDetails = await getEffectivePermissionsForSession(session);
  if (bypassesJobAccessList(role, permissionDetails)) {
    return { ok: true };
  }

  if (
    !(await hasPermission(session, 'job.puller.import_update_pdf', {
      jobNumber,
      listNumber: listNumberContext,
    }))
  ) {
    return { ok: false, error: 'Forbidden - You do not have permission to update this job', status: 403 };
  }

  const userEmail = String(session.user.email || '').trim().toLowerCase();
  if (!userEmail) {
    return { ok: false, error: 'Forbidden - Missing user email', status: 403 };
  }

  const hasRecords = await jobHasAccessRecords(jobNumber, listNumberContext);
  if (hasRecords) {
    const hasAccess = await canAccessJob(userEmail, jobNumber, listNumberContext);
    if (!hasAccess) {
      return { ok: false, error: 'Forbidden - You do not have access to this job', status: 403 };
    }
  }
  // No access records means the job is open - fall through and allow.

  return { ok: true };
}
