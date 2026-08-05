import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enforceCrmEdit, enforceCrmView } from "@/lib/crm/crmAccess";
import { createCrmTag, listCrmTags } from "@/lib/crm/crmTagService";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceCrmView(session);
    if (!access.ok) return access.response;

    const tags = await listCrmTags();
    return NextResponse.json({ tags });
  } catch (error) {
    console.error("Error in /api/crm/tags GET:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceCrmEdit(session);
    if (!access.ok) return access.response;

    const body = (await request.json()) as { name?: string; color?: string };
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "Tag name is required" }, { status: 400 });
    }

    const tag = await createCrmTag({ name: body.name, color: body.color });
    return NextResponse.json({ tag }, { status: 201 });
  } catch (error) {
    console.error("Error in /api/crm/tags POST:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
