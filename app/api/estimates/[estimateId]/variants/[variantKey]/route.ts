import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enforceStandaloneEstimatePermission } from "@/lib/estimate/estimateAccess";
import {
  deleteStandaloneEstimateVariant,
  updateStandaloneEstimateVariant,
} from "@/lib/estimate/estimateService";
import type { EstimateVariantStatus } from "@/lib/estimateTypes";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ estimateId: string; variantKey: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceStandaloneEstimatePermission(
      session,
      "estimates.variants.manage",
      "manage estimate sheets",
    );
    if (!access.ok) return access.response;

    const { estimateId, variantKey } = await params;
    const body = (await request.json()) as {
      label?: string | null;
      status?: EstimateVariantStatus | null;
    };

    const variant = await updateStandaloneEstimateVariant({
      estimateId,
      variantKey,
      label: body.label ?? null,
      status: body.status ?? null,
    });

    return NextResponse.json({ variant });
  } catch (error) {
    console.error("Error in standalone estimate variant PATCH:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ estimateId: string; variantKey: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceStandaloneEstimatePermission(
      session,
      "estimates.variants.manage",
      "manage estimate sheets",
    );
    if (!access.ok) return access.response;

    const { estimateId, variantKey } = await params;
    const result = await deleteStandaloneEstimateVariant({
      estimateId,
      variantKey,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error in standalone estimate variant DELETE:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
