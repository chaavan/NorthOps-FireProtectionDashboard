import { NextRequest, NextResponse } from 'next/server';
import { getSuppliersForParts } from '@/lib/partsDatabase';

// Mark this route as dynamic since it uses searchParams
export const dynamic = 'force-dynamic';

/**
 * GET /api/parts/suppliers?partNumbers=PN1,PN2,PN3
 * 
 * Get suppliers for a list of part numbers from the PN database sheet
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const partNumbersParam = searchParams.get('partNumbers');

    if (!partNumbersParam) {
      return NextResponse.json(
        { error: 'partNumbers parameter is required' },
        { status: 400 }
      );
    }

    // Split comma-separated part numbers
    const partNumbers = partNumbersParam.split(',').map(pn => pn.trim()).filter(Boolean);

    if (partNumbers.length === 0) {
      return NextResponse.json(
        { error: 'No valid part numbers provided' },
        { status: 400 }
      );
    }

    // Get suppliers for all part numbers
    const suppliersMap = await getSuppliersForParts(partNumbers);

    // Convert Map to object for JSON response
    const suppliers: Record<string, string> = {};
    suppliersMap.forEach((supplier, partNumber) => {
      suppliers[partNumber] = supplier;
    });

    return NextResponse.json({
      suppliers,
      count: Object.keys(suppliers).length,
    });
  } catch (error) {
    console.error('Error fetching suppliers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch suppliers', details: (error as Error).message },
      { status: 500 }
    );
  }
}

