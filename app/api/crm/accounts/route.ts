import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enforceCrmEdit, enforceCrmView } from "@/lib/crm/crmAccess";
import { createCrmAccount, listCrmAccounts } from "@/lib/crm/crmService";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceCrmView(session);
    if (!access.ok) return access.response;

    const accounts = await listCrmAccounts();
    return NextResponse.json({ accounts });
  } catch (error) {
    console.error("Error in /api/crm/accounts GET:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceCrmEdit(session);
    if (!access.ok) return access.response;

    const body = (await request.json()) as {
      name?: string;
      accountType?: string;
      salesRepEmail?: string | null;
      notes?: string | null;
      locationName?: string;
      addressLine1?: string | null;
      city?: string | null;
      state?: string | null;
      postalCode?: string | null;
    };

    if (!body.name?.trim() || !body.locationName?.trim()) {
      return NextResponse.json(
        { error: "Account name and primary location name are required" },
        { status: 400 },
      );
    }

    const result = await createCrmAccount({
      name: body.name,
      accountType: body.accountType,
      salesRepEmail: body.salesRepEmail ?? access.userEmail,
      notes: body.notes,
      locationName: body.locationName,
      addressLine1: body.addressLine1,
      city: body.city,
      state: body.state,
      postalCode: body.postalCode,
      createdBy: access.userEmail,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("Error in /api/crm/accounts POST:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
