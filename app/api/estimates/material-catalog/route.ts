import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enforceStandaloneEstimateAccess } from "@/lib/estimate/estimateAccess";
import { listMaterialCatalogRows } from "@/lib/estimate/materialCatalogService";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceStandaloneEstimateAccess(session);
    if (!access.ok) return access.response;

    const rows = await listMaterialCatalogRows();
    return NextResponse.json({ rows });
  } catch (error) {
    console.error("Error in /api/estimates/material-catalog GET:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
