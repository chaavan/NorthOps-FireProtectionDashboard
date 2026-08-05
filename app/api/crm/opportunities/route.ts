import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enforceCrmEdit, enforceCrmView } from "@/lib/crm/crmAccess";
import { createCrmOpportunity, listCrmOpportunities } from "@/lib/crm/crmService";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceCrmView(session);
    if (!access.ok) return access.response;

    const salesRepEmail = request.nextUrl.searchParams.get("salesRepEmail");
    const stage = request.nextUrl.searchParams.get("stage");
    const opportunities = await listCrmOpportunities({ salesRepEmail, stage });
    return NextResponse.json({ opportunities });
  } catch (error) {
    console.error("Error in /api/crm/opportunities GET:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceCrmEdit(session);
    if (!access.ok) return access.response;

    const body = (await request.json()) as {
      accountId?: string;
      locationId?: string | null;
      title?: string;
      opportunityType?: string;
      value?: number | null;
      salesRepEmail?: string | null;
    };

    if (!body.accountId?.trim() || !body.title?.trim()) {
      return NextResponse.json({ error: "Account and title are required" }, { status: 400 });
    }

    const opportunity = await createCrmOpportunity({
      accountId: body.accountId,
      locationId: body.locationId,
      title: body.title,
      opportunityType: body.opportunityType,
      value: body.value,
      salesRepEmail: body.salesRepEmail ?? access.userEmail,
      createdBy: access.userEmail,
    });

    return NextResponse.json({ opportunity }, { status: 201 });
  } catch (error) {
    console.error("Error in /api/crm/opportunities POST:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
