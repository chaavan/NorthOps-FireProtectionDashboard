import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enforceStandaloneEstimatePermission } from "@/lib/estimate/estimateAccess";
import {
  saveMaterialCatalogRowEdit,
  validateMaterialCatalogPassword,
  type MaterialCatalogRowPatch,
} from "@/lib/estimate/materialCatalogService";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ rowKey: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceStandaloneEstimatePermission(
      session,
      "estimates.edit",
      "edit the material catalog",
    );
    if (!access.ok) return access.response;

    const body = (await request.json()) as {
      password?: string | null;
      patch?: MaterialCatalogRowPatch;
      estimateId?: string | null;
      variantKey?: string | null;
    };
    const passwordCheck = validateMaterialCatalogPassword(body.password);
    if (!passwordCheck.ok) {
      return NextResponse.json({ error: passwordCheck.error }, { status: 403 });
    }

    const { rowKey } = await params;
    const result = await saveMaterialCatalogRowEdit({
      rowKey: decodeURIComponent(rowKey),
      patch: body.patch ?? {},
      actorEmail: access.userEmail,
      estimateId: body.estimateId ?? null,
      variantKey: body.variantKey ?? null,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error in /api/estimates/material-catalog/rows/[rowKey] PATCH:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
