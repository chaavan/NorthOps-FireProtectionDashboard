import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  enforceStandaloneEstimateAccess,
  enforceStandaloneEstimatePermission,
} from "@/lib/estimate/estimateAccess";
import {
  ACTIVE_STANDALONE_ESTIMATE_STATUSES,
  ARCHIVED_STANDALONE_ESTIMATE_STATUSES,
  createStandaloneEstimate,
  listStandaloneEstimates,
} from "@/lib/estimate/estimateService";
import type { StandaloneEstimateBidStatus } from "@/lib/estimateTypes";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceStandaloneEstimateAccess(session);
    if (!access.ok) return access.response;

    const search = request.nextUrl.searchParams.get("search");
    const includeArchived =
      request.nextUrl.searchParams.get("includeArchived") === "1" ||
      request.nextUrl.searchParams.get("includeArchived") === "true";
    const view = request.nextUrl.searchParams.get("view");
    const bidStatuses: StandaloneEstimateBidStatus[] | undefined =
      view === "archive"
        ? ARCHIVED_STANDALONE_ESTIMATE_STATUSES
        : view === "active"
          ? ACTIVE_STANDALONE_ESTIMATE_STATUSES
          : undefined;

    const estimates = await listStandaloneEstimates({
      search,
      includeArchived,
      bidStatuses,
    });
    return NextResponse.json({ estimates });
  } catch (error) {
    console.error("Error in /api/estimates GET:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceStandaloneEstimatePermission(
      session,
      "estimates.create",
      "create estimates",
    );
    if (!access.ok) return access.response;

    const body = (await request.json()) as {
      title?: string;
      projectName?: string | null;
      projectNumber?: string | null;
      locationLine1?: string | null;
      locationLine2?: string | null;
      projectDate?: string | null;
      systemLabel?: string | null;
      estimator?: string | null;
      bidDueDate?: string | null;
      squareFootage?: number | null;
      buildingTypeOptionId?: string | null;
      buildingTypeOther?: string | null;
      jobTypeOptionId?: string | null;
      jobTypeOther?: string | null;
      salesType?: "COMPETITIVE" | "NEGOTIATED" | null;
      confidenceLevel?: 1 | 2 | 3 | 4 | 5 | null;
      copyFromEstimateId?: string | null;
    };

    const title = body.title?.trim();
    if (!title) {
      return NextResponse.json(
        { error: "title is required" },
        { status: 400 },
      );
    }

    const estimate = await createStandaloneEstimate({
      title,
      projectName: body.projectName ?? null,
      projectNumber: body.projectNumber ?? null,
      locationLine1: body.locationLine1 ?? null,
      locationLine2: body.locationLine2 ?? null,
      projectDate: body.projectDate ?? null,
      systemLabel: body.systemLabel ?? null,
      estimator: body.estimator ?? null,
      bidDueDate: body.bidDueDate ?? null,
      squareFootage:
        typeof body.squareFootage === "number" && Number.isFinite(body.squareFootage)
          ? body.squareFootage
          : null,
      buildingTypeOptionId: body.buildingTypeOptionId ?? null,
      buildingTypeOther: body.buildingTypeOther ?? null,
      jobTypeOptionId: body.jobTypeOptionId ?? null,
      jobTypeOther: body.jobTypeOther ?? null,
      salesType:
        body.salesType === "COMPETITIVE" || body.salesType === "NEGOTIATED"
          ? body.salesType
          : null,
      confidenceLevel:
        body.confidenceLevel === 1 ||
        body.confidenceLevel === 2 ||
        body.confidenceLevel === 3 ||
        body.confidenceLevel === 4 ||
        body.confidenceLevel === 5
          ? body.confidenceLevel
          : null,
      copyFromEstimateId: body.copyFromEstimateId ?? null,
      userEmail: access.userEmail,
    });

    return NextResponse.json(estimate, { status: 201 });
  } catch (error) {
    console.error("Error in /api/estimates POST:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
