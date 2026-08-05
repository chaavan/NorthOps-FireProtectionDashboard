import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/parts/unsnooze
 * Clears a part's reorder snooze so it returns to the To Order tab.
 * The inverse of the snooze applied when an inventory line is removed from
 * To Order (see app/api/admin/orders/cancel/route.ts).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    // Un-snoozing puts the part back on To Order, so it's gated by the same
    // permission as snoozing (removing) an item there.
    const canUnsnooze =
      (await hasPermission(session, 'orders.cancel')) ||
      (await hasPermission(session, 'orders.to_order.edit'));
    if (!canUnsnooze) {
      return NextResponse.json(
        { error: 'Forbidden - Permission required', permission: 'orders.to_order.edit' },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const partNumber = String((body as { partNumber?: string }).partNumber ?? '').trim();
    if (!partNumber) {
      return NextResponse.json({ error: 'partNumber is required' }, { status: 400 });
    }

    try {
      const result = await prisma.part.updateMany({
        where: { pn: partNumber },
        data: { reorderSnoozedAt: null },
      });
      if (result.count === 0) {
        return NextResponse.json({ error: 'Part not found' }, { status: 404 });
      }
      return NextResponse.json({ ok: true, partNumber, updated: result.count });
    } catch {
      // reorder_snoozed_at column not present yet (migration pending).
      return NextResponse.json(
        { error: 'Un-snooze is unavailable until the reorder-snooze update is applied' },
        { status: 503 },
      );
    }
  } catch (error) {
    console.error('Error in /api/admin/parts/unsnooze POST:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
