import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

type UnifiedRow = {
  kind: string;
  event_id: string;
  part_id: string;
  created_at: Date;
  actor_user_id: string | null;
  payload: unknown;
};

function parseKinds(raw: string | null): Set<string> {
  const d = (raw || 'quantity,cost,profile')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const allowed = new Set(['quantity', 'cost', 'profile']);
  const s = new Set<string>();
  for (const k of d) {
    if (allowed.has(k)) s.add(k);
  }
  if (s.size === 0) {
    return new Set(['quantity', 'cost', 'profile']);
  }
  return s;
}

function invPart(partId: string | null): Prisma.Sql {
  if (!partId) return Prisma.sql``;
  return Prisma.sql`AND im.part_id = ${partId}`;
}

function invDates(start?: Date, end?: Date): Prisma.Sql {
  if (!start && !end) return Prisma.sql``;
  if (start && end) {
    return Prisma.sql`AND im.created_at >= ${start} AND im.created_at <= ${end}`;
  }
  if (start) return Prisma.sql`AND im.created_at >= ${start}`;
  return Prisma.sql`AND im.created_at <= ${end!}`;
}

function costPart(partId: string | null): Prisma.Sql {
  if (!partId) return Prisma.sql``;
  return Prisma.sql`AND pcc.part_id = ${partId}`;
}

function costDates(start?: Date, end?: Date): Prisma.Sql {
  if (!start && !end) return Prisma.sql``;
  if (start && end) {
    return Prisma.sql`AND pcc.created_at >= ${start} AND pcc.created_at <= ${end}`;
  }
  if (start) return Prisma.sql`AND pcc.created_at >= ${start}`;
  return Prisma.sql`AND pcc.created_at <= ${end!}`;
}

function infoPart(partId: string | null): Prisma.Sql {
  if (!partId) return Prisma.sql``;
  return Prisma.sql`AND pic.part_id = ${partId}`;
}

function infoDates(start?: Date, end?: Date): Prisma.Sql {
  if (!start && !end) return Prisma.sql``;
  if (start && end) {
    return Prisma.sql`AND pic.created_at >= ${start} AND pic.created_at <= ${end}`;
  }
  if (start) return Prisma.sql`AND pic.created_at >= ${start}`;
  return Prisma.sql`AND pic.created_at <= ${end!}`;
}

/**
 * GET /api/admin/part-unified-log
 * Merged timeline (quantity / cost / part-info) with server-side pagination.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    const auth = await requirePermission(session, 'inventory.cost_history.view');
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const partId = searchParams.get('partId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const kinds = parseKinds(searchParams.get('kinds'));

    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? (() => {
      const e = new Date(endDate);
      e.setHours(23, 59, 59, 999);
      return e;
    })() : undefined;

    const skip = (page - 1) * limit;

    const segments: Prisma.Sql[] = [];
    if (kinds.has('quantity')) {
      segments.push(Prisma.sql`
        SELECT 'quantity'::text AS kind, im.id::text AS event_id, im.part_id, im.created_at, im.actor_user_id,
          to_jsonb(im) AS payload
        FROM inventory_movements im
        WHERE 1=1
        ${invPart(partId)}
        ${invDates(start, end)}
      `);
    }
    if (kinds.has('cost')) {
      segments.push(Prisma.sql`
        SELECT 'cost'::text AS kind, pcc.id::text AS event_id, pcc.part_id, pcc.created_at, pcc.actor_user_id,
          to_jsonb(pcc) AS payload
        FROM part_cost_changes pcc
        WHERE 1=1
        ${costPart(partId)}
        ${costDates(start, end)}
      `);
    }
    if (kinds.has('profile')) {
      segments.push(Prisma.sql`
        SELECT 'profile'::text AS kind, pic.id::text AS event_id, pic.part_id, pic.created_at, pic.actor_user_id,
          to_jsonb(pic) AS payload
        FROM part_info_changes pic
        WHERE 1=1
        ${infoPart(partId)}
        ${infoDates(start, end)}
      `);
    }

    if (segments.length === 0) {
      return NextResponse.json({
        events: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
      });
    }

    const unionInner = Prisma.join(segments, ' UNION ALL ');

    const countRows = await prisma.$queryRaw<[{ c: bigint }]>(
      Prisma.sql`SELECT COUNT(*)::bigint AS c FROM (${unionInner}) AS u`,
    );
    const total = Number(countRows[0]?.c ?? 0);

    const events = await prisma.$queryRaw<UnifiedRow[]>(
      Prisma.sql`
        SELECT * FROM (${unionInner}) AS u
        ORDER BY u.created_at DESC, u.event_id DESC
        LIMIT ${limit} OFFSET ${skip}
      `,
    );

    const partIds = [...new Set(events.map((e) => e.part_id))];
    const parts =
      partIds.length > 0
        ? await prisma.part.findMany({
            where: { id: { in: partIds } },
            select: { id: true, pn: true, nomenclature: true },
          })
        : [];
    const partMap = new Map(parts.map((p) => [p.id, p]));

    const actorIds = [...new Set(events.map((e) => e.actor_user_id).filter(Boolean))] as string[];
    const actors =
      actorIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, name: true, email: true },
          })
        : [];
    const actorMap = new Map(actors.map((a) => [a.id, a]));

    return NextResponse.json({
      events: events.map((e) => ({
        kind: e.kind,
        eventId: e.event_id,
        partId: e.part_id,
        part: partMap.get(e.part_id) ?? { id: e.part_id, pn: '?', nomenclature: '' },
        actorUserId: e.actor_user_id,
        actor: e.actor_user_id
          ? (() => {
              const a = actorMap.get(e.actor_user_id!);
              return a ? { name: a.name, email: a.email } : null;
            })()
          : null,
        payload: e.payload,
        createdAt: e.created_at,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error in /api/admin/part-unified-log GET:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
