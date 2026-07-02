import { NextRequest, NextResponse } from 'next/server';
import { requireVendorPriceDiscardAccess } from '@/lib/vendorPriceImport/requireAdmin';
import { discardVendorPriceImport } from '@/lib/vendorPriceImport/vendorPriceImportService';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireVendorPriceDiscardAccess();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    await discardVendorPriceImport(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error discarding vendor price import:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to discard import.' },
      { status: 500 },
    );
  }
}
