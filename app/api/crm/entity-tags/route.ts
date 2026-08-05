import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enforceCrmEdit, enforceCrmView } from "@/lib/crm/crmAccess";
import {
  addTagToEntity,
  listTagsForEntity,
  removeTagFromEntity,
} from "@/lib/crm/crmTagService";
import { CRM_ENTITY_TYPES, type CrmEntityType } from "@/lib/crm/crmTypes";

export const dynamic = "force-dynamic";

function validEntity(entityType: string | null, entityId: string | null): entityType is CrmEntityType {
  return (
    !!entityType &&
    !!entityId &&
    CRM_ENTITY_TYPES.includes(entityType as CrmEntityType)
  );
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceCrmView(session);
    if (!access.ok) return access.response;

    const entityType = request.nextUrl.searchParams.get("entityType");
    const entityId = request.nextUrl.searchParams.get("entityId");
    if (!validEntity(entityType, entityId)) {
      return NextResponse.json({ error: "Valid entityType and entityId are required" }, { status: 400 });
    }

    const tags = await listTagsForEntity(entityType, entityId as string);
    return NextResponse.json({ tags });
  } catch (error) {
    console.error("Error in /api/crm/entity-tags GET:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceCrmEdit(session);
    if (!access.ok) return access.response;

    const body = (await request.json()) as { tagId?: string; entityType?: string; entityId?: string };
    if (!body.tagId || !validEntity(body.entityType ?? null, body.entityId ?? null)) {
      return NextResponse.json({ error: "tagId, entityType and entityId are required" }, { status: 400 });
    }

    await addTagToEntity({
      tagId: body.tagId,
      entityType: body.entityType as CrmEntityType,
      entityId: body.entityId as string,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error in /api/crm/entity-tags POST:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceCrmEdit(session);
    if (!access.ok) return access.response;

    const tagId = request.nextUrl.searchParams.get("tagId");
    const entityType = request.nextUrl.searchParams.get("entityType");
    const entityId = request.nextUrl.searchParams.get("entityId");
    if (!tagId || !validEntity(entityType, entityId)) {
      return NextResponse.json({ error: "tagId, entityType and entityId are required" }, { status: 400 });
    }

    await removeTagFromEntity({ tagId, entityType, entityId: entityId as string });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error in /api/crm/entity-tags DELETE:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
