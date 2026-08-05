import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enforceCrmEdit } from "@/lib/crm/crmAccess";
import { createCrmRenewal } from "@/lib/crm/crmService";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceCrmEdit(session);
    if (!access.ok) return access.response;

    const body = (await request.json()) as {
      accountId?: string;
      locationId?: string | null;
      contractName?: string;
      serviceType?: string;
      renewalDate?: string;
      annualValue?: number | null;
      salesRepEmail?: string | null;
      notes?: string | null;
    };

    if (!body.accountId?.trim() || !body.contractName?.trim() || !body.renewalDate) {
      return NextResponse.json(
        { error: "accountId, contractName, and renewalDate are required" },
        { status: 400 },
      );
    }

    const renewal = await createCrmRenewal({
      accountId: body.accountId,
      locationId: body.locationId,
      contractName: body.contractName,
      serviceType: body.serviceType,
      renewalDate: body.renewalDate,
      annualValue: body.annualValue,
      salesRepEmail: body.salesRepEmail ?? access.userEmail,
      notes: body.notes,
      createdBy: access.userEmail,
    });

    return NextResponse.json({ renewal }, { status: 201 });
  } catch (error) {
    console.error("Error in /api/crm/renewals POST:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
