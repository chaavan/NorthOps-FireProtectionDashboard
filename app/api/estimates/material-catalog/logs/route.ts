import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enforceStandaloneEstimatePermission } from "@/lib/estimate/estimateAccess";
import { listMaterialCatalogEditLogs } from "@/lib/estimate/materialCatalogService";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceStandaloneEstimatePermission(
      session,
      "estimates.edit",
      "view material catalog edit logs",
    );
    if (!access.ok) return access.response;

    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "100");
    const logs = await listMaterialCatalogEditLogs(limit);
    return NextResponse.json({ logs });
  } catch (error) {
    console.error("Error in /api/estimates/material-catalog/logs GET:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
