import { NextRequest, NextResponse } from 'next/server';
import { requireVendorPriceReviewAccess } from '@/lib/vendorPriceImport/requireAdmin';
import type { UpdateReviewInput } from '@/lib/vendorPriceImport/vendorPriceImportTypes';
import { updateVendorPriceImportReview } from '@/lib/vendorPriceImport/vendorPriceImportService';

export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireVendorPriceReviewAccess();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const body = (await request.json()) as UpdateReviewInput;
    const review = await updateVendorPriceImportReview(id, body);
    return NextResponse.json({ review });
  } catch (error) {
    console.error('Error updating vendor price import review:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update review.' },
      { status: 500 },
    );
  }
}
