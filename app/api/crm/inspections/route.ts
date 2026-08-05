import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enforceCrmEdit } from "@/lib/crm/crmAccess";
import { createCrmInspectionWithDeficiencies } from "@/lib/crm/crmService";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceCrmEdit(session);
    if (!access.ok) return access.response;

    const body = (await request.json()) as {
      accountId?: string;
      locationId?: string | null;
      inspectionType?: string;
      inspectedAt?: string | null;
      inspectorName?: string | null;
      salesRepEmail?: string | null;
      notes?: string | null;
      deficiencies?: Array<{
        title: string;
        description?: string | null;
        severity?: string;
        estimatedValue?: number | null;
      }>;
    };

    if (!body.accountId?.trim()) {
      return NextResponse.json({ error: "accountId is required" }, { status: 400 });
    }
    if (!body.deficiencies?.length) {
      return NextResponse.json(
        { error: "At least one deficiency is required" },
        { status: 400 },
      );
    }

    const result = await createCrmInspectionWithDeficiencies({
      accountId: body.accountId,
      locationId: body.locationId,
      inspectionType: body.inspectionType,
      inspectedAt: body.inspectedAt,
      inspectorName: body.inspectorName,
      salesRepEmail: body.salesRepEmail ?? access.userEmail,
      notes: body.notes,
      createdBy: access.userEmail,
      deficiencies: body.deficiencies,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("Error in /api/crm/inspections POST:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
