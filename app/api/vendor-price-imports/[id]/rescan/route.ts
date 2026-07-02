import { NextRequest, NextResponse } from 'next/server';
import { requireVendorPriceReviewAccess } from '@/lib/vendorPriceImport/requireAdmin';
import {
  getVendorPriceImportResponse,
  parseVendorPriceImport,
} from '@/lib/vendorPriceImport/vendorPriceImportService';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireVendorPriceReviewAccess();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const existing = await prisma.vendorPriceImport.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Import session not found.' }, { status: 404 });
    }
    if (existing.status === 'COMMITTED') {
      return NextResponse.json(
        { error: 'Applied imports cannot be rescanned.' },
        { status: 400 },
      );
    }
    if (!existing.sourceFileBytes) {
      return NextResponse.json({ error: 'Source file is missing.' }, { status: 400 });
    }

    await prisma.vendorPriceImport.update({
      where: { id },
      data: { status: 'PROCESSING', errorMessage: null },
    });

    await parseVendorPriceImport(id);
    const response = await getVendorPriceImportResponse(id);
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error rescanning vendor price import:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to rescan import.' },
      { status: 500 },
    );
  }
}
