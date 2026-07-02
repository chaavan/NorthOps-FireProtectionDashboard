import { NextRequest, NextResponse } from 'next/server';
import { getPartDetails } from '@/lib/partsDatabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/parts/details?partNumber=XXX
 * 
 * Get complete part details (description, unit of measurement, type/supplier) for a single part number
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const partNumber = searchParams.get('partNumber');

    if (!partNumber) {
      return NextResponse.json(
        { error: 'partNumber parameter is required' },
        { status: 400 }
      );
    }

    const partDetails = await getPartDetails(partNumber);

    return NextResponse.json(partDetails);
  } catch (error) {
    console.error('Error fetching part details:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch part details', 
        details: (error as Error).message,
        found: false 
      },
      { status: 500 }
    );
  }
}


