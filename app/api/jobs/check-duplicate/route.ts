import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { checkJobExists, getNextListNumber } from '@/lib/jobsDatabase';

// Force this route to be dynamic
export const dynamic = 'force-dynamic';

/**
 * POST /api/jobs/check-duplicate
 * Check if a job with the given jobNumber and listNumber exists
 * 
 * Request body:
 * {
 *   jobNumber: string,
 *   listNumber?: string
 * }
 * 
 * Response:
 * {
 *   exists: boolean,
 *   existingJob?: {
 *     jobNumber: string,
 *     jobName: string,
 *     listNumber: string,
 *     partCount: number,
 *     existingParts: Array<{ partNumber, description, quantityNeeded }>
 *   },
 *   nextAvailableListNumber: string
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { jobNumber, listNumber } = body;

    if (!jobNumber || !jobNumber.trim()) {
      return NextResponse.json(
        { error: 'jobNumber is required' },
        { status: 400 }
      );
    }

    // Get next available list number for this job
    const nextAvailableListNumber = await getNextListNumber(jobNumber.trim());

    // Use provided listNumber or default to next available
    const finalListNumber = listNumber?.trim() || nextAvailableListNumber;

    // Check if job exists
    const result = await checkJobExists(jobNumber.trim(), finalListNumber);

    return NextResponse.json({
      exists: result.exists,
      existingJob: result.existingJob,
      nextAvailableListNumber,
    });

  } catch (error) {
    console.error('❌ Error in /api/jobs/check-duplicate:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to check duplicate';
    
    return NextResponse.json(
      { 
        error: errorMessage,
        message: errorMessage,
      },
      { status: 500 }
    );
  }
}
