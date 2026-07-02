import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enforceStandaloneEstimatePermission } from "@/lib/estimate/estimateAccess";
import { validateMaterialCatalogPassword } from "@/lib/estimate/materialCatalogService";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceStandaloneEstimatePermission(
      session,
      "estimates.edit",
      "unlock material catalog editing",
    );
    if (!access.ok) return access.response;

    const body = (await request.json()) as { password?: string | null };
    const passwordCheck = validateMaterialCatalogPassword(body.password);
    if (!passwordCheck.ok) {
      return NextResponse.json({ error: passwordCheck.error }, { status: 403 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error in /api/estimates/material-catalog/unlock POST:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
