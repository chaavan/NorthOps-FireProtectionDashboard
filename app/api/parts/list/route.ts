import { NextRequest, NextResponse } from 'next/server';
import { getPartsList } from '@/lib/partsDatabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/parts/list
 * 
 * Get paginated list of parts with optional search
 * Query parameters:
 * - search: optional search term (searches across pn, nomenclature, vendor)
 * - page: page number (default: 1)
 * - limit: items per page (default: 50)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const searchTerm = searchParams.get('search') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const result = await getPartsList(searchTerm, page, limit);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching parts list:', error);
    return NextResponse.json(
      { error: 'Failed to fetch parts list', details: (error as Error).message },
      { status: 500 }
    );
  }
}

