import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requirePermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { normalizeListNumber } from '@/lib/jobListContext';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/orders/pending
 * Returns all job items with ordered=true AND receivedFromOrder=false
 * Grouped by job number
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const auth = await requirePermission(session, 'orders.view');
    if (!auth.ok) return auth.response;

    // Fetch all items that are ordered but not received
    const orderedItems = await prisma.job.findMany({
      where: {
        ordered: true,
        receivedFromOrder: false,
      },
      orderBy: [
        { jobNumber: 'asc' },
        { partNumber: 'asc' },
      ],
    });

    // Group items by job number + list number (legacy endpoint; keep consistent with other tabs)
    const jobsMap = new Map<string, {
      jobNumber: string;
      jobName: string;
      items: Array<{
        partNumber: string;
        description: string | null;
        quantityOrdered: number | null;
        quantityNeeded: number;
        quantityPulled: number;
        vendor: string | null;
      }>;
    }>();

    orderedItems.forEach((item) => {
      const listKey = normalizeListNumber(item.listNumber);
      const jobKey = `${item.jobNumber}::${listKey}`;

      if (!jobsMap.has(jobKey)) {
        jobsMap.set(jobKey, {
          jobNumber: item.jobNumber,
          jobName: item.jobName,
          items: [],
        });
      }

      jobsMap.get(jobKey)!.items.push({
        partNumber: item.partNumber,
        description: item.description,
        quantityOrdered: item.quantityOrdered,
        quantityNeeded: item.quantityNeeded,
        quantityPulled: item.pulled,
        vendor: item.type,
      });
    });

    const jobs = Array.from(jobsMap.values());

    return NextResponse.json({
      jobs,
      totalItems: orderedItems.length,
      totalJobs: jobs.length,
    });
  } catch (error) {
    console.error('Error in /api/admin/orders/pending:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

