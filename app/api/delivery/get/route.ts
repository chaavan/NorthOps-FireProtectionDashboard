import { NextRequest, NextResponse } from 'next/server';
import { getDeliveryRecord } from '@/lib/deliveryDatabase';
import { cache, cacheKeys, cacheTTL } from '@/lib/cache';
import { normalizeListContextForLookup } from '@/lib/jobListContext';

// Force this route to be dynamic
export const dynamic = 'force-dynamic';

/**
 * GET /api/delivery/get?jobNumber=XXX
 * Returns delivery record for a specific job
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const jobNumber = searchParams.get('jobNumber');
    const listNumberContext =
      searchParams.get('listNumber') ?? searchParams.get('listNumberContext');

    if (!jobNumber) {
      return NextResponse.json(
        { error: 'jobNumber query parameter is required' },
        { status: 400 }
      );
    }

    const normalizedListNumber = normalizeListContextForLookup(listNumberContext);

    // Check cache first
    const cacheKey = cacheKeys.delivery(jobNumber, normalizedListNumber);
    const cached = cache.get<{ delivery: any }>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const result = await getDeliveryRecord(jobNumber, listNumberContext);
    const response = { delivery: result };
    
    // Cache the response
    cache.set(cacheKey, response, cacheTTL.delivery);
    
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error in /api/delivery/get:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

