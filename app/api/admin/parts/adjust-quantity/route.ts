import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, resolveSessionUserIdForAudit } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/permissions';
import { parseSignedInt } from '@/lib/inventoryQuantity';
import {
  parseManualReasonCode,
  recordManualAdjustment,
} from '@/lib/inventoryLedger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/parts/adjust-quantity
 * Path 1 — manual inventory correction (Inventory tab only).
 * Body: { partId, quantityDelta, reasonCode, reasonDetail, note? }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    const auth = await requirePermission(session, 'inventory.adjust_quantity');
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const { partId, quantityDelta, reasonCode: rawReasonCode, reasonDetail, note } = body;

    if (!partId || quantityDelta === undefined) {
      return NextResponse.json(
        { error: 'partId and quantityDelta are required' },
        { status: 400 },
      );
    }

    const reasonCode = parseManualReasonCode(rawReasonCode);
    if (!reasonCode) {
      return NextResponse.json(
        {
          error:
            'reasonCode is required and must be COUNT, STOCK_IN, DAMAGE, SUPPLIER, CORRECTION, or OTHER',
        },
        { status: 400 },
      );
    }

    const detail = typeof reasonDetail === 'string' ? reasonDetail : '';
    if (!detail.trim()) {
      return NextResponse.json(
        { error: 'reasonDetail is required (describe why you are adjusting stock)' },
        { status: 400 },
      );
    }

    const parsedDelta = parseSignedInt(quantityDelta, 'quantityDelta');
    if (!parsedDelta.ok) {
      return NextResponse.json({ error: parsedDelta.error }, { status: 400 });
    }

    const actorUserId = await resolveSessionUserIdForAudit(session);

    const result = await prisma.$transaction(async (tx) => {
      const { movement } = await recordManualAdjustment(tx, {
        partId,
        signedDelta: parsedDelta.value,
        actorUserId,
        reasonCode,
        reasonDetail: detail,
        additionalNote: typeof note === 'string' ? note : null,
      });

      const updatedPart = await tx.part.findUnique({
        where: { id: partId },
      });

      if (!updatedPart) {
        throw new Error('Part not found');
      }

      return { part: updatedPart, movement };
    });

    return NextResponse.json({
      success: true,
      part: {
        ...result.part,
        quantity: Number(result.part.quantity),
      },
      movement: {
        ...result.movement,
        quantityBefore: Number(result.movement.quantityBefore),
        quantityAfter: Number(result.movement.quantityAfter),
      },
    });
  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error('Error in /api/admin/parts/adjust-quantity POST:', error);

    if (errorMessage === 'NEGATIVE_STOCK') {
      return NextResponse.json(
        { error: 'NEGATIVE_STOCK', message: 'Resulting quantity cannot be negative' },
        { status: 400 },
      );
    }

    if (errorMessage === 'Part not found') {
      return NextResponse.json({ error: 'Part not found' }, { status: 404 });
    }

    if (
      errorMessage.includes('characters') ||
      errorMessage.includes('Other') ||
      errorMessage.includes('zero')
    ) {
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
