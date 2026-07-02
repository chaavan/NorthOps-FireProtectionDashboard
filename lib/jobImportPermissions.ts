import "server-only";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getJobImport } from "@/lib/jobImportService";
import { hasPermission, requirePermission } from "@/lib/permissions";
import type { PermissionKey } from "@/lib/permissionCatalog";

type SessionLike =
  | {
      user?: {
        email?: string | null;
      } | null;
    }
  | null
  | undefined;

type JobImportAccess = {
  id: string;
  createdBy: string;
  status?: string;
  mode?: string;
};

type WatcherAccess = {
  id: string;
  createdBy: string;
};

export function getSessionEmail(session: SessionLike): string {
  return String(session?.user?.email || "").trim().toLowerCase();
}

function isOwner(session: SessionLike, createdBy?: string | null): boolean {
  const email = getSessionEmail(session);
  return Boolean(email && createdBy && createdBy.trim().toLowerCase() === email);
}

async function canManageOwnJobImportDrafts(session: SessionLike): Promise<boolean> {
  return (
    (await hasPermission(session, "job_import.drafts.view_own")) ||
    (await hasPermission(session, "job_import.upload"))
  );
}

export async function canViewJobImportDraft(
  session: SessionLike,
  jobImport: JobImportAccess,
): Promise<boolean> {
  if (!(await hasPermission(session, "job_import.view"))) return false;
  if (await hasPermission(session, "job_import.drafts.view_all")) return true;
  return isOwner(session, jobImport.createdBy) && (await canManageOwnJobImportDrafts(session));
}

export async function canEditJobImportDraft(
  session: SessionLike,
  jobImport: JobImportAccess,
): Promise<boolean> {
  if (!(await canViewJobImportDraft(session, jobImport))) return false;
  if (isOwner(session, jobImport.createdBy)) {
    return canManageOwnJobImportDrafts(session);
  }
  return (
    (await hasPermission(session, "job_import.drafts.view_all")) &&
    (await hasPermission(session, "job_import.drafts.edit_others"))
  );
}

export async function requireJobImportPageAccess(session: SessionLike) {
  return requirePermission(session, "job_import.view");
}

export async function requireJobImportUploadAccess(session: SessionLike) {
  const page = await requireJobImportPageAccess(session);
  if (!page.ok) return page;
  return requirePermission(session, "job_import.upload");
}

export async function requireJobImportCommitAccess(session: SessionLike, importId: string) {
  const draft = await getJobImport(importId);
  if (!(await hasPermission(session, "job_import.commit")) || !(await canEditJobImportDraft(session, draft))) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Forbidden - You do not have permission to commit this job import draft" },
        { status: 403 },
      ),
    };
  }
  return { ok: true as const, draft };
}

export async function requireJobImportViewAccess(session: SessionLike, importId: string) {
  const draft = await getJobImport(importId);
  if (!(await canViewJobImportDraft(session, draft))) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Forbidden - You do not have permission to view this job import draft" },
        { status: 403 },
      ),
    };
  }
  return { ok: true as const, draft };
}

export async function requireJobImportEditAccess(session: SessionLike, importId: string) {
  const draft = await getJobImport(importId);
  if (!(await canEditJobImportDraft(session, draft))) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Forbidden - You do not have permission to edit this job import draft" },
        { status: 403 },
      ),
    };
  }
  return { ok: true as const, draft };
}

export async function getJobImportDraftListScope(session: SessionLike): Promise<{
  ok: boolean;
  createdBy: string | null;
  response?: NextResponse<{ error: string }>;
}> {
  const page = await requireJobImportPageAccess(session);
  if (!page.ok) return { ok: false, createdBy: null, response: page.response };

  if (await hasPermission(session, "job_import.drafts.view_all")) {
    return { ok: true, createdBy: null };
  }

  if (await canManageOwnJobImportDrafts(session)) {
    return { ok: true, createdBy: getSessionEmail(session) };
  }

  return {
    ok: false,
    createdBy: null,
    response: NextResponse.json(
      { error: "Forbidden - You do not have permission to view job import drafts" },
      { status: 403 },
    ),
  };
}

export async function canViewHydraTecWatcher(
  session: SessionLike,
  watcher: WatcherAccess,
): Promise<boolean> {
  if (!(await hasPermission(session, "job_import.view"))) return false;
  if (await hasPermission(session, "job_import.hydratec_watchers.view_all")) return true;
  return (
    isOwner(session, watcher.createdBy) &&
    (await hasPermission(session, "job_import.hydratec_watchers.view_own"))
  );
}

export async function getHydraTecWatcherListScope(session: SessionLike): Promise<{
  ok: boolean;
  createdBy: string | null;
  response?: NextResponse<{ error: string }>;
}> {
  const page = await requireJobImportPageAccess(session);
  if (!page.ok) return { ok: false, createdBy: null, response: page.response };

  if (await hasPermission(session, "job_import.hydratec_watchers.view_all")) {
    return { ok: true, createdBy: null };
  }

  if (await hasPermission(session, "job_import.hydratec_watchers.view_own")) {
    return { ok: true, createdBy: getSessionEmail(session) };
  }

  return {
    ok: false,
    createdBy: null,
    response: NextResponse.json(
      { error: "Forbidden - You do not have permission to view HydraTec watchers" },
      { status: 403 },
    ),
  };
}

export async function requireHydraTecWatcherPermission(session: SessionLike, key: PermissionKey) {
  const page = await requireJobImportPageAccess(session);
  if (!page.ok) return page;
  return requirePermission(session, key);
}

export async function requireHydraTecWatcherRegenerateAccess(session: SessionLike, watcherId: string) {
  const watcher = await (prisma as any).hydraTecWatcherKey.findUnique({
    where: { id: watcherId },
    select: { id: true, createdBy: true },
  });
  if (!watcher) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Watcher not found." }, { status: 404 }),
    };
  }

  if (
    !isOwner(session, watcher.createdBy) ||
    !(await hasPermission(session, "job_import.hydratec_watchers.regenerate_own"))
  ) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Forbidden - Only the creator can regenerate and reconnect this watcher" },
        { status: 403 },
      ),
    };
  }

  return { ok: true as const, watcher };
}
