import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { createVendor, listUnifiedVendors } from "@/lib/vendorService";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized - Please sign in" }, { status: 401 });
    }

    const canList =
      (await hasPermission(session, "orders.suppliers.manage")) ||
      (await hasPermission(session, "orders.generate_send")) ||
      (await hasPermission(session, "orders.view"));
    if (!canList) {
      return NextResponse.json(
        { error: "Forbidden - Permission required" },
        { status: 403 },
      );
    }

    const vendors = await listUnifiedVendors();
    return NextResponse.json({ vendors });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const auth = await requirePermission(session, "orders.suppliers.manage");
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const vendor = await createVendor({
      displayName: body.displayName,
      toEmails: body.toEmails,
      ccEmails: body.ccEmails,
      isActive: body.isActive,
      vendorKeyOverride: body.vendorKeyOverride,
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
    const status = message.includes("required") || message.includes("Invalid") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
