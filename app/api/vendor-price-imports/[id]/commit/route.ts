import { NextRequest, NextResponse } from 'next/server';
import { requireVendorPriceCommitAccess } from '@/lib/vendorPriceImport/requireAdmin';
import { commitVendorPriceImport } from '@/lib/vendorPriceImport/vendorPriceImportService';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireVendorPriceCommitAccess();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const result = await commitVendorPriceImport({
      importId: id,
      actorUserId: auth.userId,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Error committing vendor price import:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to commit import.' },
      { status: 500 },
    );
  }
}
