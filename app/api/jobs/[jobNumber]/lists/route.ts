import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, isAdmin } from "@/lib/auth";
import { getAccessibleListsForUser } from "@/lib/jobAccess";
import { getJobListSummariesForJob } from "@/lib/jobsDatabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/jobs/[jobNumber]/lists
 * Returns accessible list summaries (list number + area) for the current user.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobNumber: string }> },
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized - Please sign in" },
        { status: 401 },
      );
    }

    const { jobNumber } = await params;
    if (!jobNumber?.trim()) {
      return NextResponse.json(
        { error: "jobNumber is required" },
        { status: 400 },
      );
    }

    const userEmail = (session.user as { email?: string }).email?.trim();
    if (!userEmail) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const role = (session.user as { role?: string }).role;
    const allLists = await getJobListSummariesForJob(jobNumber);
    const lists = await getAccessibleListsForUser({
      userEmail,
      jobNumber,
      isAdmin: isAdmin(role),
      allLists,
    });

    const response = NextResponse.json({ lists });
    response.headers.set("Cache-Control", "no-store, max-age=0");
    return response;
  } catch (error) {
    console.error("Error in /api/jobs/[jobNumber]/lists:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
