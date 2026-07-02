import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  enforceStandaloneEstimateAccess,
  enforceStandaloneEstimatePermission,
} from "@/lib/estimate/estimateAccess";
import {
  createStandaloneEstimateVariant,
  listStandaloneEstimateVariants,
} from "@/lib/estimate/estimateService";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ estimateId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceStandaloneEstimateAccess(session);
    if (!access.ok) return access.response;

    const { estimateId } = await params;
    const variants = await listStandaloneEstimateVariants({ estimateId });
    return NextResponse.json({ variants });
  } catch (error) {
    console.error("Error in standalone estimate variants GET:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ estimateId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceStandaloneEstimatePermission(
      session,
      "estimates.variants.manage",
      "manage estimate sheets",
    );
    if (!access.ok) return access.response;

    const { estimateId } = await params;
    const body = (await request.json()) as {
      variantKey?: string;
      variantLabel?: string | null;
      copyFromVariantKey?: string | null;
    };

    if (!body.variantKey || typeof body.variantKey !== "string") {
      return NextResponse.json(
        { error: "variantKey is required" },
        { status: 400 },
      );
    }

    const estimate = await createStandaloneEstimateVariant({
      estimateId,
      variantKey: body.variantKey,
      variantLabel: body.variantLabel ?? null,
      copyFromVariantKey: body.copyFromVariantKey ?? null,
      userEmail: access.userEmail,
    });

    return NextResponse.json(estimate, { status: 201 });
  } catch (error) {
    console.error("Error in standalone estimate variants POST:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
