import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { archiveVendor, updateVendor } from "@/lib/vendorService";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions);
    const auth = await requirePermission(session, "orders.suppliers.manage");
    if (!auth.ok) return auth.response;

    const { id } = await context.params;
    const body = await request.json();
    const vendor = await updateVendor(id, {
      displayName: body.displayName,
      toEmails: body.toEmails,
      ccEmails: body.ccEmails,
      isActive: body.isActive,
    });

    return NextResponse.json({ success: true, vendor });
  } catch (error) {
    if ((error as any)?.code === "P2002") {
      return NextResponse.json(
        { error: "A vendor with this name already exists." },
        { status: 409 },
      );
    }
    const message = (error as Error).message;
    const status = message === "Vendor not found." ? 404 : message.includes("required") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions);
    const auth = await requirePermission(session, "orders.suppliers.manage");
    if (!auth.ok) return auth.response;

    const { id } = await context.params;
    const vendor = await archiveVendor(id);
    return NextResponse.json({ success: true, vendor });
  } catch (error) {
    const message = (error as Error).message;
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
