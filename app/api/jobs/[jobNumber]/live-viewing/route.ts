import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canAccessJob, jobHasAccessRecords } from "@/lib/jobAccess";
import { getEffectivePermissionsForSession } from "@/lib/permissions";
import { bypassesJobAccessList } from "@/lib/jobScopedAccess";
import {
  getLiveViewersForJobList,
  pruneExpiredLiveViewSessions,
  removeLiveViewSession,
  sanitizeSessionId,
  upsertLiveViewSession,
} from "@/lib/jobPageSync";

export const dynamic = "force-dynamic";

async function canReadJobContextForList(
  user: any,
  jobNumber: string,
  listNumberContext: string | null | undefined,
  session: { user?: { role?: string | null; email?: string | null } } | null,
): Promise<boolean> {
  if (!user) return false;
  const permissionDetails = await getEffectivePermissionsForSession(session);
  if (bypassesJobAccessList(user.role, permissionDetails)) return true;

  const userEmail = String(user.email || "").trim().toLowerCase();
  if (!userEmail) return false;

  // Scoped to the list being viewed - a job can have access records on one
  // list but not another, and an unscoped check would wrongly treat every
  // list on the job as restricted.
  const hasRecords = await jobHasAccessRecords(jobNumber, listNumberContext);
  if (!hasRecords) {
    // Preserve current behavior for legacy jobs without access rows.
    return true;
  }

  return canAccessJob(userEmail, jobNumber, listNumberContext);
}

async function buildLiveViewingPayload(options: {
  jobNumber: string;
  listNumberContext: string | null | undefined;
  currentUserId?: string | null;
}) {
  const viewers = await getLiveViewersForJobList({
    jobNumber: options.jobNumber,
    listNumberContext: options.listNumberContext,
    currentUserId: options.currentUserId,
  });

  return {
    viewers,
    staleAfterSeconds: 45,
    serverTime: new Date().toISOString(),
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobNumber: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized - Please sign in" }, { status: 401 });
    }

    const { jobNumber } = await params;
    if (!jobNumber?.trim()) {
      return NextResponse.json({ error: "jobNumber is required" }, { status: 400 });
    }

    const listNumberContext = request.nextUrl.searchParams.get("listNumber");
    const hasAccess = await canReadJobContextForList(
      session.user as any,
      jobNumber.trim(),
      listNumberContext,
      session,
    );
    if (!hasAccess) {
      return NextResponse.json(
        { error: "Forbidden - You do not have access to this job" },
        { status: 403 },
      );
    }

    await pruneExpiredLiveViewSessions();

    const payload = await buildLiveViewingPayload({
      jobNumber: jobNumber.trim(),
      listNumberContext,
      currentUserId: (session.user as any).id || null,
    });

    return NextResponse.json(payload);
  } catch (error) {
    console.error("Error in /api/jobs/[jobNumber]/live-viewing GET:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobNumber: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized - Please sign in" }, { status: 401 });
    }

    const { jobNumber } = await params;
    if (!jobNumber?.trim()) {
      return NextResponse.json({ error: "jobNumber is required" }, { status: 400 });
    }

    const body = await request.json();
    const hasAccess = await canReadJobContextForList(
      session.user as any,
      jobNumber.trim(),
      typeof body?.listNumber === "string" ? body.listNumber : null,
      session,
    );
    if (!hasAccess) {
      return NextResponse.json(
        { error: "Forbidden - You do not have access to this job" },
        { status: 403 },
      );
    }

    const sessionId = sanitizeSessionId(body?.sessionId);
    if (!sessionId) {
      return NextResponse.json({ error: "A valid sessionId is required" }, { status: 400 });
    }

    await pruneExpiredLiveViewSessions();

    await upsertLiveViewSession({
      sessionId,
      jobNumber: jobNumber.trim(),
      listNumberContext: body?.listNumber,
      activeTab: body?.activeTab,
      userId: String((session.user as any).id || ""),
      userEmail: String((session.user as any).email || ""),
      userName: (session.user as any).name || null,
    });

    const payload = await buildLiveViewingPayload({
      jobNumber: jobNumber.trim(),
      listNumberContext: body?.listNumber,
      currentUserId: (session.user as any).id || null,
    });

    return NextResponse.json(payload);
  } catch (error) {
    console.error("Error in /api/jobs/[jobNumber]/live-viewing POST:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ jobNumber: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized - Please sign in" }, { status: 401 });
    }

    const { jobNumber } = await params;
    if (!jobNumber?.trim()) {
      return NextResponse.json({ error: "jobNumber is required" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const sessionId = sanitizeSessionId(body?.sessionId);
    if (!sessionId) {
      return NextResponse.json({ error: "A valid sessionId is required" }, { status: 400 });
    }

    await removeLiveViewSession({
      sessionId,
      userId: String((session.user as any).id || ""),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error in /api/jobs/[jobNumber]/live-viewing DELETE:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
