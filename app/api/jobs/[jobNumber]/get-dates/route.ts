import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { toDateKeyInAppTimeZone } from '@/lib/timezone';
import { normalizeListContextForLookup } from '@/lib/jobListContext';
import { getCanonicalJobListDate } from '@/lib/jobListDeliveryDate';

// Force this route to be dynamic
export const dynamic = 'force-dynamic';

/**
 * GET /api/jobs/[jobNumber]/get-dates?partNumber=XXX
 * Gets deliveryDate (and listedBy) for a job (from any line item, they're all the same)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobNumber: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const { jobNumber } = await params;
    const searchParams = request.nextUrl.searchParams;
    const partNumber = searchParams.get('partNumber');
    const listNumberParam = searchParams.get('listNumber');
    const normalizedListNumber = normalizeListContextForLookup(listNumberParam);

    if (!jobNumber) {
      return NextResponse.json(
        { error: 'jobNumber is required' },
        { status: 400 }
      );
    }

    const job = await getCanonicalJobListDate(jobNumber, normalizedListNumber, partNumber);

    if (!job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      deliveryDate: job.deliveryDate ? toDateKeyInAppTimeZone(job.deliveryDate) : null,
      listedBy: job.listedBy || null,
    });
  } catch (error) {
    console.error('Error in /api/jobs/[jobNumber]/get-dates:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
