import { NextResponse } from 'next/server';
import { getAllVendors } from '@/lib/partsDatabase';
import { cache, cacheKeys, cacheTTL } from '@/lib/cache';

export const dynamic = 'force-dynamic';

/**
 * GET /api/parts/vendors
 *
 * Returns all unique vendors from the parts database.
 * Vendors are returned as lowercase canonical keys (deduplicated case-insensitively, sorted).
 */
export async function GET() {
  try {
    // Check cache first
    const cacheKey = cacheKeys.vendors();
    const cached = cache.get<string[]>(cacheKey);
    if (cached) {
      return NextResponse.json({ vendors: cached });
    }

    const vendors = await getAllVendors();

    // Cache the response
    cache.set(cacheKey, vendors, cacheTTL.vendors || 3600); // Cache for 1 hour

    return NextResponse.json({ vendors });
  } catch (error) {
    console.error('Error fetching vendors:', error);
    return NextResponse.json(
      { error: 'Failed to fetch vendors', details: (error as Error).message },
      { status: 500 }
    );
  }
}


