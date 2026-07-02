import { NextResponse } from 'next/server';
import { requireVendorPricePageAccess } from '@/lib/vendorPriceImport/requireAdmin';
import { listVendorPriceProfiles } from '@/lib/vendorPriceImport/vendorPriceImportService';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const auth = await requireVendorPricePageAccess();
    if (!auth.ok) return auth.response;

    const profiles = await listVendorPriceProfiles();
    return NextResponse.json({
      profiles: profiles.map((p) => ({
        vendorKey: p.vendorKey,
        displayName: p.displayName,
        parserType: p.parserType,
      })),
    });
  } catch (error) {
    console.error('Error listing vendor price profiles:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list vendor profiles.' },
      { status: 500 },
    );
  }
}
