import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  enforceStandaloneEstimateAccess,
  enforceStandaloneEstimatePermission,
} from "@/lib/estimate/estimateAccess";
import {
  createEstimateLookupOption,
  isEstimateLookupCategory,
  listEstimateLookupOptions,
} from "@/lib/estimate/estimateLookupService";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceStandaloneEstimateAccess(session);
    if (!access.ok) return access.response;

    const category = request.nextUrl.searchParams.get("category") ?? "";
    if (!isEstimateLookupCategory(category)) {
      return NextResponse.json(
        { error: "category must be building_type or job_type" },
        { status: 400 },
      );
    }

    const options = await listEstimateLookupOptions({ category });
    return NextResponse.json({ options });
  } catch (error) {
    console.error("Error in /api/estimates/lookup-options GET:", error);
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
      "estimates.edit_info",
      "manage estimate dropdown options",
    );
    if (!access.ok) return access.response;

    const body = (await request.json()) as { category?: string; label?: string };
    const category = body.category ?? "";
    const label = body.label ?? "";

    if (!isEstimateLookupCategory(category)) {
      return NextResponse.json(
        { error: "category must be building_type or job_type" },
        { status: 400 },
      );
    }

    const option = await createEstimateLookupOption({
      category,
      label,
      createdBy: access.userEmail,
    });

    return NextResponse.json({ option });
  } catch (error) {
    console.error("Error in /api/estimates/lookup-options POST:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
