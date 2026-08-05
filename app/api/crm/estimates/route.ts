import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enforceCrmEdit, enforceCrmPermission } from "@/lib/crm/crmAccess";
import { linkDeficienciesToEstimate, listEstimatesForCrmLink } from "@/lib/crm/crmService";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceCrmPermission(session, "crm.link_estimates", "link estimates");
    if (!access.ok) return access.response;

    const search = request.nextUrl.searchParams.get("search");
    const estimates = await listEstimatesForCrmLink(search);
    return NextResponse.json({
      estimates: estimates.map((estimate) => ({
        id: estimate.id,
        title: estimate.title,
        projectName: estimate.projectName,
        projectNumber: estimate.projectNumber,
        bidStatus: estimate.bidStatus,
        totalCost: estimate.variants[0]?.totalCost
          ? Number(estimate.variants[0].totalCost)
          : null,
      })),
    });
  } catch (error) {
    console.error("Error in /api/crm/estimates GET:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceCrmPermission(session, "crm.link_estimates", "link estimates");
    if (!access.ok) return access.response;

    const body = (await request.json()) as {
      estimateId?: string;
      deficiencyIds?: string[];
    };

    if (!body.estimateId?.trim() || !body.deficiencyIds?.length) {
      return NextResponse.json(
        { error: "estimateId and deficiencyIds are required" },
        { status: 400 },
      );
    }

    const result = await linkDeficienciesToEstimate({
      estimateId: body.estimateId,
      deficiencyIds: body.deficiencyIds,
      updatedBy: access.userEmail,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error in /api/crm/estimates POST:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
