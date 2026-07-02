import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/inventory-movements
 * Returns paginated audit log, filterable by partId, date range, actorUserId, contextId
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const auth = await requirePermission(session, 'inventory.logs.view');
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const partId = searchParams.get('partId');
    const actorUserId = searchParams.get('actorUserId');
    const contextType = searchParams.get('contextType');
    const contextId = searchParams.get('contextId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {};
    if (partId) where.partId = partId;
    if (actorUserId) where.actorUserId = actorUserId;
    if (contextType) where.contextType = contextType;
    if (contextId) where.contextId = contextId;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    // Get total count
    const total = await prisma.inventoryMovement.count({ where });

    // Get movements with actor (user) for display name
    const movements = await prisma.inventoryMovement.findMany({
      where,
      skip,
      take: limit,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        part: {
          select: {
            id: true,
            pn: true,
            nomenclature: true,
          },
        },
        actor: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    return NextResponse.json({
      movements: movements.map(m => ({
        id: m.id,
        partId: m.partId,
        part: m.part,
        actorUserId: m.actorUserId,
        actor: m.actor ? { name: m.actor.name, email: m.actor.email } : null,
        type: m.type,
        quantityDelta: m.quantityDelta,
        quantityBefore: Number(m.quantityBefore),
        quantityAfter: Number(m.quantityAfter),
        contextType: m.contextType,
        contextId: m.contextId,
        note: m.note,
        createdAt: m.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error in /api/admin/inventory-movements GET:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

