import { NextRequest, NextResponse } from 'next/server';
import { requireVendorPricePageAccess } from '@/lib/vendorPriceImport/requireAdmin';
import { getVendorPriceImportResponse } from '@/lib/vendorPriceImport/vendorPriceImportService';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireVendorPricePageAccess();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const response = await getVendorPriceImportResponse(id);
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching vendor price import:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch import.' },
      { status: 500 },
    );
  }
}
