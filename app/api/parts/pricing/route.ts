import { NextRequest, NextResponse } from 'next/server';
import { getPricingForParts } from '@/lib/partsDatabase';
import { cache, cacheKeys, cacheTTL } from '@/lib/cache';

export const dynamic = 'force-dynamic';

/**
 * GET /api/parts/pricing?partNumbers=PN1,PN2,PN3
 * 
 * Get pricing (cost and supplier) for a list of part numbers from the database
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

    // Check cache first
    const cacheKey = cacheKeys.pricing(partNumbers);
    const cached = cache.get<{ pricing: Record<string, { cost: number; supplier: string }>; count: number }>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    // Get pricing and supplier for all part numbers
    const pricingMap = await getPricingForParts(partNumbers);

    // Convert Map to object for JSON response
    const pricing: Record<string, { cost: number; supplier: string }> = {};
    pricingMap.forEach((data, partNumber) => {
      pricing[partNumber] = data;
    });

    const response = {
      pricing,
      count: Object.keys(pricing).length,
    };

    // Cache the response
    cache.set(cacheKey, response, cacheTTL.pricing);

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching pricing:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pricing', details: (error as Error).message },
      { status: 500 }
    );
  }
}

