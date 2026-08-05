import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enforceCrmEdit, enforceCrmView } from "@/lib/crm/crmAccess";
import {
  deleteCrmContact,
  getCrmContact,
  updateCrmContact,
} from "@/lib/crm/crmContactService";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
) {
  try {
    const { contactId } = await params;
    const session = await getServerSession(authOptions);
    const access = await enforceCrmView(session);
    if (!access.ok) return access.response;

    const contact = await getCrmContact(contactId);
    if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    return NextResponse.json({ contact });
  } catch (error) {
    console.error("Error in /api/crm/contacts/[contactId] GET:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
) {
  try {
    const { contactId } = await params;
    const session = await getServerSession(authOptions);
    const access = await enforceCrmEdit(session);
    if (!access.ok) return access.response;

    const body = (await request.json()) as {
      name?: string;
      email?: string | null;
      phone?: string | null;
      role?: string;
      isPrimary?: boolean;
      notes?: string | null;
      locationId?: string | null;
    };

    const contact = await updateCrmContact(contactId, body);
    return NextResponse.json({ contact });
  } catch (error) {
    console.error("Error in /api/crm/contacts/[contactId] PATCH:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
) {
  try {
    const { contactId } = await params;
    const session = await getServerSession(authOptions);
    const access = await enforceCrmEdit(session);
    if (!access.ok) return access.response;

    await deleteCrmContact(contactId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error in /api/crm/contacts/[contactId] DELETE:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
