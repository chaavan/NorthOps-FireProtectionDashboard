import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enforceCrmEdit, enforceCrmView } from "@/lib/crm/crmAccess";
import { createCrmContact, listCrmContacts } from "@/lib/crm/crmContactService";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceCrmView(session);
    if (!access.ok) return access.response;

    const accountId = request.nextUrl.searchParams.get("accountId");
    const search = request.nextUrl.searchParams.get("search");
    const contacts = await listCrmContacts({ accountId, search });
    return NextResponse.json({ contacts });
  } catch (error) {
    console.error("Error in /api/crm/contacts GET:", error);
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
      name?: string;
      email?: string | null;
      phone?: string | null;
      role?: string;
      isPrimary?: boolean;
      notes?: string | null;
    };

    if (!body.accountId?.trim() || !body.name?.trim()) {
      return NextResponse.json(
        { error: "Account and contact name are required" },
        { status: 400 },
      );
    }

    const contact = await createCrmContact({
      accountId: body.accountId,
      locationId: body.locationId,
      name: body.name,
      email: body.email,
      phone: body.phone,
      role: body.role,
      isPrimary: body.isPrimary,
      notes: body.notes,
    });

    return NextResponse.json({ contact }, { status: 201 });
  } catch (error) {
    console.error("Error in /api/crm/contacts POST:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
