import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

/** GET /api/admin/part-info-changes — admin-only profile field audit */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    const auth = await requirePermission(session, 'inventory.cost_history.view');
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const partId = searchParams.get('partId');
    const actorUserId = searchParams.get('actorUserId');
    const contextType = searchParams.get('contextType');
    const contextId = searchParams.get('contextId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (partId) where.partId = partId;
    if (actorUserId) where.actorUserId = actorUserId;
    if (contextType) where.contextType = contextType;
    if (contextId) where.contextId = contextId;
    if (startDate || endDate) {
      (where as any).createdAt = {};
      if (startDate) (where as any).createdAt.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        (where as any).createdAt.lte = end;
      }
    }

    const total = await (prisma as any).partInfoChange.count({ where: where as any });

    const rows = await (prisma as any).partInfoChange.findMany({
      where: where as any,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        part: {
          select: { id: true, pn: true, nomenclature: true },
        },
        actor: {
          select: { name: true, email: true },
        },
      },
    });

    return NextResponse.json({
      changes: rows.map((r: (typeof rows)[number]) => ({
        id: r.id,
        partId: r.partId,
        part: r.part,
        actorUserId: r.actorUserId,
        actor: r.actor ? { name: r.actor.name, email: r.actor.email } : null,
        contextType: r.contextType,
        contextId: r.contextId,
        changes: r.changes,
        note: r.note,
        createdAt: r.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error in /api/admin/part-info-changes GET:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
