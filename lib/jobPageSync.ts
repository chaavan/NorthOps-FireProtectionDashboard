import { prisma } from "@/lib/prisma";

export type JobDetailTabKey =
  | "puller"
  | "delivery"
  | "purchase-order"
  | "notes"
  | "access";

const ALLOWED_TABS: JobDetailTabKey[] = [
  "puller",
  "delivery",
  "purchase-order",
  "notes",
  "access",
];

export const LIVE_VIEW_TTL_SECONDS = 45;
export const LIST_CONTEXT_ALL = "__ALL__";

export type LiveViewerSummary = {
  userId: string;
  userEmail: string;
  userName: string | null;
  lastSeenAt: string;
  isCurrentUser: boolean;
};

function deriveDisplayName(email: string): string {
  const local = email.split("@")[0] || email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function staleCutoffDate(): Date {
  return new Date(Date.now() - LIVE_VIEW_TTL_SECONDS * 1000);
}

export function normalizeListContext(
  listNumber: string | null | undefined,
): string {
  const value = typeof listNumber === "string" ? listNumber.trim() : "";
  return value.length > 0 ? value : LIST_CONTEXT_ALL;
}

export function sanitizeActiveTab(
  activeTab: string | null | undefined,
): JobDetailTabKey {
  if (!activeTab) return "puller";
  const value = activeTab.trim() as JobDetailTabKey;
  return ALLOWED_TABS.includes(value) ? value : "puller";
}

export function sanitizeSessionId(
  sessionId: string | null | undefined,
): string | null {
  if (!sessionId) return null;
  const trimmed = sessionId.trim();
  if (trimmed.length < 8 || trimmed.length > 128) return null;
  if (!/^[a-zA-Z0-9:_-]+$/.test(trimmed)) return null;
  return trimmed;
}

export async function pruneExpiredLiveViewSessions(): Promise<void> {
  await prisma.jobLiveViewSession.deleteMany({
    where: {
      lastSeenAt: {
        lt: staleCutoffDate(),
      },
    },
  });
}

export async function upsertLiveViewSession(options: {
  sessionId: string;
  jobNumber: string;
  listNumberContext: string | null | undefined;
  activeTab: string | null | undefined;
  userId: string;
  userEmail: string;
  userName?: string | null;
}): Promise<void> {
  const now = new Date();
  await prisma.jobLiveViewSession.upsert({
    where: {
      sessionId: options.sessionId,
    },
    update: {
      jobNumber: options.jobNumber.trim(),
      listNumber: normalizeListContext(options.listNumberContext),
      activeTab: sanitizeActiveTab(options.activeTab),
      userId: options.userId,
      userEmail: options.userEmail,
      userName: options.userName?.trim() || null,
      lastSeenAt: now,
    },
    create: {
      sessionId: options.sessionId,
      jobNumber: options.jobNumber.trim(),
      listNumber: normalizeListContext(options.listNumberContext),
      activeTab: sanitizeActiveTab(options.activeTab),
      userId: options.userId,
      userEmail: options.userEmail,
      userName: options.userName?.trim() || null,
      lastSeenAt: now,
    },
  });
}

export async function removeLiveViewSession(options: {
  sessionId: string;
  userId: string;
}): Promise<void> {
  await prisma.jobLiveViewSession.deleteMany({
    where: {
      sessionId: options.sessionId,
      userId: options.userId,
    },
  });
}

export async function getLiveViewersForJobList(options: {
  jobNumber: string;
  listNumberContext: string | null | undefined;
  currentUserId?: string | null;
}): Promise<LiveViewerSummary[]> {
  const normalizedJobNumber = options.jobNumber.trim();
  const normalizedListContext = normalizeListContext(options.listNumberContext);
  const cutoff = staleCutoffDate();

  const sessions = await prisma.jobLiveViewSession.findMany({
    where: {
      jobNumber: normalizedJobNumber,
      listNumber: normalizedListContext,
      lastSeenAt: {
        gte: cutoff,
      },
    },
    orderBy: [{ lastSeenAt: "desc" }],
  });

  const viewerMap = new Map<
    string,
    {
      userId: string;
      userEmail: string;
      userName: string | null;
      lastSeenAt: Date;
    }
  >();

  for (const session of sessions) {
    const key = session.userId || session.userEmail.toLowerCase();
    const existing = viewerMap.get(key);
    if (!existing) {
      viewerMap.set(key, {
        userId: session.userId,
        userEmail: session.userEmail,
        userName:
          session.userName?.trim() || deriveDisplayName(session.userEmail),
        lastSeenAt: session.lastSeenAt,
      });
      continue;
    }

    if (session.lastSeenAt > existing.lastSeenAt) {
      existing.lastSeenAt = session.lastSeenAt;
    }
  }

  return Array.from(viewerMap.values())
    .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
    .map((viewer) => ({
      userId: viewer.userId,
      userEmail: viewer.userEmail,
      userName: viewer.userName,
      lastSeenAt: viewer.lastSeenAt.toISOString(),
      isCurrentUser: !!options.currentUserId && viewer.userId === options.currentUserId,
    }));
}
