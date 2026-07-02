import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enforceStandaloneEstimatePermission } from "@/lib/estimate/estimateAccess";
import {
  EstimateContractPriceRequiredError,
  EstimateMetadataValidationError,
} from "@/lib/estimate/estimateMetadata";
import {
  restoreStandaloneEstimate,
  updateStandaloneEstimateBidStatus,
} from "@/lib/estimate/estimateService";
import type { StandaloneEstimateBidStatus } from "@/lib/estimateTypes";

export const dynamic = "force-dynamic";

const ALLOWED_STATUSES = new Set<StandaloneEstimateBidStatus>([
  "DRAFT",
  "SENT",
  "WON",
  "LOST",
  "ARCHIVED",
]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ estimateId: string }> },
) {
  try {
    const { estimateId } = await params;
    const body = (await request.json()) as {
      bidStatus?: StandaloneEstimateBidStatus;
      contractPrice?: number | null;
      restore?: boolean;
    };

    const session = await getServerSession(authOptions);
    const access = await enforceStandaloneEstimatePermission(
      session,
      body.restore ? "estimates.archive" : "estimates.change_status",
      body.restore ? "restore estimates" : "edit estimate status",
    );
    if (!access.ok) return access.response;

    const estimate = body.restore
      ? await restoreStandaloneEstimate({
          estimateId,
          userEmail: access.userEmail,
        })
      : await updateStandaloneEstimateBidStatus({
          estimateId,
          bidStatus: ALLOWED_STATUSES.has(body.bidStatus as StandaloneEstimateBidStatus)
            ? (body.bidStatus as StandaloneEstimateBidStatus)
            : "DRAFT",
          contractPrice:
            typeof body.contractPrice === "number" && Number.isFinite(body.contractPrice)
              ? body.contractPrice
              : null,
          userEmail: access.userEmail,
        });

    return NextResponse.json({ estimate });
  } catch (error) {
    if (error instanceof EstimateMetadataValidationError) {
      return NextResponse.json(
        {
          error: error.message,
          missingFields: error.missingFields,
        },
        { status: 400 },
      );
    }
    if (error instanceof EstimateContractPriceRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Error in standalone estimate status PATCH:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
