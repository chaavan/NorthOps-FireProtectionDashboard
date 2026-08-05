import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enforceCrmEdit } from "@/lib/crm/crmAccess";
import {
  updateCrmOpportunityFields,
  updateCrmOpportunityStage,
} from "@/lib/crm/crmService";
import { CRM_OPPORTUNITY_STAGES, type CrmOpportunityStage } from "@/lib/crm/crmTypes";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ opportunityId: string }> },
) {
  try {
    const { opportunityId } = await params;
    const session = await getServerSession(authOptions);
    const access = await enforceCrmEdit(session);
    if (!access.ok) return access.response;

    const body = (await request.json()) as {
      stage?: CrmOpportunityStage;
      scheduledAt?: string | null;
      lostReason?: string | null;
      title?: string;
      value?: number | null;
      salesRepEmail?: string | null;
    };

    const hasStage = body.stage !== undefined;
    const hasFields =
      body.title !== undefined || body.value !== undefined || body.salesRepEmail !== undefined;

    if (!hasStage && !hasFields) {
      return NextResponse.json(
        { error: "Provide a stage and/or fields to update (title, value, salesRepEmail)" },
        { status: 400 },
      );
    }

    // Field edits first so a combined update lands both.
    if (hasFields) {
      await updateCrmOpportunityFields(opportunityId, {
        title: body.title,
        value: body.value,
        salesRepEmail: body.salesRepEmail,
        updatedBy: access.userEmail,
      });
    }

    if (hasStage) {
      if (!CRM_OPPORTUNITY_STAGES.includes(body.stage as CrmOpportunityStage)) {
        return NextResponse.json({ error: `Invalid stage: ${body.stage}` }, { status: 400 });
      }
      const opportunity = await updateCrmOpportunityStage({
        opportunityId,
        stage: body.stage as CrmOpportunityStage,
        scheduledAt: body.scheduledAt,
        lostReason: body.lostReason,
        updatedBy: access.userEmail,
      });
      return NextResponse.json({ opportunity });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error in /api/crm/opportunities/[opportunityId] PATCH:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
