import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { listUnifiedVendors } from '@/lib/vendorService';

export const dynamic = 'force-dynamic';

/**
 * GET /api/vendors/directory
 * Minimal, read-only supplier list (name + key only) for pickers such as the
 * "Add Part" stock-in dialog. Accessible to anyone who can view suppliers or do a
 * stock-in — narrower data than /api/admin/vendors (no emails).
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    const canView = (
      await Promise.all([
        hasPermission(session, 'job.stock_back.create'),
        hasPermission(session, 'orders.view'),
        hasPermission(session, 'orders.suppliers.manage'),
        hasPermission(session, 'inventory.view'),
      ])
    ).some(Boolean);
    if (!canView) {
      return NextResponse.json({ error: 'Forbidden - Permission required' }, { status: 403 });
    }

    const vendors = await listUnifiedVendors();
    const suppliers = vendors
      .filter((v) => v.isActive)
      .map((v) => ({ vendorKey: v.vendorKey, displayName: v.displayName }));

    return NextResponse.json({ suppliers });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
