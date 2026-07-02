import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { recalculateStandaloneEstimateDraft } from "@/lib/estimate/estimateService";
import type { EstimateDraft } from "@/lib/estimateTypes";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ estimateId: string }> },
) {
  try {
    await params;
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized - Please sign in" },
        { status: 401 },
      );
    }

    const canEditWorkbook = await hasPermission(session, "estimates.edit");
    const canEditPricing = await hasPermission(session, "estimates.pricing_controls.edit");
    if (!canEditWorkbook && !canEditPricing) {
      return NextResponse.json(
        { error: "Forbidden - Permission required to edit estimate values" },
        { status: 403 },
      );
    }

    const body = (await request.json()) as { draft?: EstimateDraft };
    if (!body.draft) {
      return NextResponse.json(
        { error: "draft is required" },
        { status: 400 },
      );
    }

    const computed = await recalculateStandaloneEstimateDraft(body.draft);
    return NextResponse.json({ computed });
  } catch (error) {
    console.error("Error in estimate recalculate route:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
