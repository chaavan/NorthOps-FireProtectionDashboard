import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enforceCrmEdit, enforceCrmView } from "@/lib/crm/crmAccess";
import {
  deleteCrmAccount,
  getCrmAccountDetail,
  updateCrmAccount,
} from "@/lib/crm/crmService";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const { accountId } = await params;
    const session = await getServerSession(authOptions);
    const access = await enforceCrmView(session);
    if (!access.ok) return access.response;

    const account = await getCrmAccountDetail(accountId);
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    return NextResponse.json({ account });
  } catch (error) {
    console.error("Error in /api/crm/accounts/[accountId] GET:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const { accountId } = await params;
    const session = await getServerSession(authOptions);
    const access = await enforceCrmEdit(session);
    if (!access.ok) return access.response;

    const body = (await request.json()) as {
      name?: string;
      accountType?: string;
      salesRepEmail?: string | null;
      notes?: string | null;
    };

    const account = await updateCrmAccount(accountId, { ...body, updatedBy: access.userEmail });
    return NextResponse.json({ account });
  } catch (error) {
    console.error("Error in /api/crm/accounts/[accountId] PATCH:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const { accountId } = await params;
    const session = await getServerSession(authOptions);
    const access = await enforceCrmEdit(session);
    if (!access.ok) return access.response;

    await deleteCrmAccount(accountId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error in /api/crm/accounts/[accountId] DELETE:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
