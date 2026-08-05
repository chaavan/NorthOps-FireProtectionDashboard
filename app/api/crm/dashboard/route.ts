import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enforceCrmView } from "@/lib/crm/crmAccess";
import { getCrmDashboard } from "@/lib/crm/crmService";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceCrmView(session);
    if (!access.ok) return access.response;

    const salesRepEmail = request.nextUrl.searchParams.get("salesRepEmail");
    const dashboard = await getCrmDashboard({ salesRepEmail });
    return NextResponse.json({ dashboard });
  } catch (error) {
    console.error("Error in /api/crm/dashboard GET:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
