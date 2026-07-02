import { NextRequest, NextResponse } from 'next/server';
import {
  requireVendorPricePageAccess,
  requireVendorPriceReviewAccess,
} from '@/lib/vendorPriceImport/requireAdmin';
import {
  createVendorPriceImportDraft,
  getVendorPriceImportResponse,
  listVendorPriceImports,
} from '@/lib/vendorPriceImport/vendorPriceImportService';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireVendorPricePageAccess();
    if (!auth.ok) return auth.response;

    const take = Number.parseInt(request.nextUrl.searchParams.get('take') || '20', 10);
    const statusParam = request.nextUrl.searchParams.get('status');
    const statuses = statusParam
      ? statusParam.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
      : undefined;

    const imports = await listVendorPriceImports({ take, statuses });
    return NextResponse.json({ imports });
  } catch (error) {
    console.error('Error listing vendor price imports:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list imports.' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireVendorPriceReviewAccess();
    if (!auth.ok) return auth.response;

    const formData = await request.formData();
    const file = formData.get('file');
    const vendorKey = String(formData.get('vendorKey') || 'etna').trim().toLowerCase();

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'A spreadsheet file is required.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const record = await createVendorPriceImportDraft({
      fileName: file.name,
      contentType: file.type || null,
      fileBytes: buffer,
      vendorKey,
      createdByUserId: auth.userId,
    });

    const response = await getVendorPriceImportResponse(record.id);

    return NextResponse.json({
      success: record.status === 'READY',
      import: {
        id: response.import.id,
        status: response.import.status,
        sourceFileName: response.import.sourceFileName,
        vendorKey: response.import.vendorKey,
        errorMessage: response.import.errorMessage,
      },
      review: response.review,
    });
  } catch (error) {
    console.error('Error creating vendor price import:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create import.' },
      { status: 500 },
    );
  }
}
