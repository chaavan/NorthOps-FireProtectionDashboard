import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import {
  enforceStandaloneEstimateAccess,
  enforceStandaloneEstimatePermission,
} from "@/lib/estimate/estimateAccess";
import {
  deleteStandaloneEstimate,
  getStandaloneEstimate,
  saveStandaloneEstimate,
  saveStandaloneEstimateInfo,
  updateStandaloneEstimateMetadata,
} from "@/lib/estimate/estimateService";
import type { EstimateDraft } from "@/lib/estimateTypes";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ estimateId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceStandaloneEstimateAccess(session);
    if (!access.ok) return access.response;

    const { estimateId } = await params;
    const variantKey = request.nextUrl.searchParams.get("variantKey");
    const estimate = await getStandaloneEstimate({
      estimateId,
      variantKey,
      userEmail: access.userEmail,
    });

    return NextResponse.json(estimate);
  } catch (error) {
    console.error("Error in /api/estimates/[estimateId] GET:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ estimateId: string }> },
) {
  try {
    const { estimateId } = await params;
    const body = (await request.json()) as {
      variantKey?: string | null;
      saveMode?: "info" | "workbook";
      draft?: EstimateDraft;
      title?: string | null;
      projectName?: string | null;
      projectNumber?: string | null;
      locationLine1?: string | null;
      locationLine2?: string | null;
      contractPrice?: number | null;
    };

    const session = await getServerSession(authOptions);
    const accessUserEmail =
      ((session?.user as any)?.email as string | undefined) ?? null;

    if (body.draft) {
      const canEditWorkbook = await hasPermission(session, "estimates.edit");
      const canEditPricing = await hasPermission(
        session,
        "estimates.pricing_controls.edit",
      );
      const canEditInfo = await hasPermission(session, "estimates.edit_info");
      const infoOnlySave =
        body.saveMode === "info" ||
        (canEditInfo && !canEditWorkbook && !canEditPricing);

      if (infoOnlySave) {
        const access = await enforceStandaloneEstimatePermission(
          session,
          "estimates.edit_info",
          "edit estimate info",
        );
        if (!access.ok) return access.response;

        const estimate = await saveStandaloneEstimateInfo({
          estimateId,
          variantKey: body.variantKey ?? null,
          project: body.draft.project,
          title: body.title ?? null,
          projectName: body.projectName ?? null,
          projectNumber: body.projectNumber ?? null,
          locationLine1: body.locationLine1 ?? null,
          locationLine2: body.locationLine2 ?? null,
          userEmail: accessUserEmail,
        });
        return NextResponse.json(estimate);
      }

      if (!canEditWorkbook && !canEditPricing) {
        const access = await enforceStandaloneEstimatePermission(
          session,
          "estimates.edit",
          "edit estimate workbooks",
        );
        if (!access.ok) return access.response;
      }

      const estimate = await saveStandaloneEstimate({
        estimateId,
        variantKey: body.variantKey ?? null,
        draft: body.draft,
        title: body.title ?? null,
        projectName: body.projectName ?? null,
        projectNumber: body.projectNumber ?? null,
        locationLine1: body.locationLine1 ?? null,
        locationLine2: body.locationLine2 ?? null,
        userEmail: accessUserEmail,
      });
      return NextResponse.json(estimate);
    }

    if (body.contractPrice !== undefined) {
      const access = await enforceStandaloneEstimatePermission(
        session,
        "estimates.pricing_controls.edit",
        "edit pricing controls",
      );
      if (!access.ok) return access.response;
    } else {
      const access = await enforceStandaloneEstimatePermission(
        session,
        "estimates.edit_info",
        "edit estimate info",
      );
      if (!access.ok) return access.response;
    }

    const estimate = await updateStandaloneEstimateMetadata({
      estimateId,
      title: body.title ?? null,
      projectName: body.projectName ?? null,
      projectNumber: body.projectNumber ?? null,
      locationLine1: body.locationLine1 ?? null,
      locationLine2: body.locationLine2 ?? null,
      contractPrice:
        typeof body.contractPrice === "number" && Number.isFinite(body.contractPrice)
          ? body.contractPrice
          : body.contractPrice === null
            ? null
            : undefined,
      userEmail: accessUserEmail,
    });
    return NextResponse.json({ estimate });
  } catch (error) {
    console.error("Error in /api/estimates/[estimateId] PUT:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ estimateId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceStandaloneEstimatePermission(
      session,
      "estimates.archive",
      "archive, restore, or delete estimates",
    );
    if (!access.ok) return access.response;

    const { estimateId } = await params;
    const result = await deleteStandaloneEstimate({ estimateId });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error in /api/estimates/[estimateId] DELETE:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
