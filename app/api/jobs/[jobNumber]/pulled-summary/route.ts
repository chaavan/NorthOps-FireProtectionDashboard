import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * GET /api/jobs/[jobNumber]/pulled-summary
 * Returns per-part net pulled quantities for a job.
 *
 * - Shop pulls: from PartAllocation (quantityPulled, which already backs inventory movements)
 * - Vendor pulls: from job rows (quantityReceivedFromOrder)
 *
 * The response combines both into a single total per part so the UI
 * can show the full quantity that would be added back on job delete.
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

    const role = (session.user as any).role;
    if (!isAdmin(role)) {
      return NextResponse.json(
        { error: 'Forbidden - Admin access required' },
        { status: 403 }
      );
    }

    const { jobNumber } = await params;
    const normalizedJobNumber = jobNumber?.trim();

    if (!normalizedJobNumber) {
      return NextResponse.json(
        { error: 'jobNumber is required' },
        { status: 400 }
      );
    }

    // 1) Shop pulls from PartAllocation (affect on-hand inventory)
    const allocations = await prisma.partAllocation.findMany({
      where: {
        jobId: normalizedJobNumber,
        quantityPulled: {
          gt: 0,
        },
      },
      select: {
        partId: true,
        quantityPulled: true,
      },
    });

    // Fetch parts for allocations so we know their part numbers
    const allocationPartIds = Array.from(
      new Set(allocations.map((a) => a.partId)),
    );
    const allocationParts = allocationPartIds.length
      ? await prisma.part.findMany({
          where: { id: { in: allocationPartIds } },
          select: {
            id: true,
            pn: true,
            nomenclature: true,
          },
        })
      : [];
    const partsById = new Map(allocationParts.map((p) => [p.id, p]));

    // 2) Vendor quantities from job rows (do not currently change inventory,
    // but should be treated as "pulled" for delete-job add-back behavior)
    const jobRows = await prisma.job.findMany({
      where: {
        jobNumber: normalizedJobNumber,
        quantityReceivedFromOrder: {
          gt: 0,
        },
      },
      select: {
        partNumber: true,
        quantityReceivedFromOrder: true,
      },
    });

    if (allocations.length === 0 && jobRows.length === 0) {
      return NextResponse.json({
        jobNumber: normalizedJobNumber,
        parts: [],
      });
    }

    type Totals = {
      shopPulled: number;
      vendorPulled: number;
    };

    // Group by partNumber and sum both sources
    const totalsByPartNumber = new Map<string, Totals>();

    // From allocations (shop pulls)
    for (const alloc of allocations) {
      const part = partsById.get(alloc.partId);
      const pn = part?.pn;
      if (!pn) continue;
      const existing = totalsByPartNumber.get(pn) ?? {
        shopPulled: 0,
        vendorPulled: 0,
      };
      existing.shopPulled += alloc.quantityPulled;
      totalsByPartNumber.set(pn, existing);
    }

    // From job rows (vendor pulls)
    for (const row of jobRows) {
      const pn = row.partNumber;
      if (!pn) continue;
      const existing = totalsByPartNumber.get(pn) ?? {
        shopPulled: 0,
        vendorPulled: 0,
      };
      existing.vendorPulled += row.quantityReceivedFromOrder ?? 0;
      totalsByPartNumber.set(pn, existing);
    }

    if (totalsByPartNumber.size === 0) {
      return NextResponse.json({
        jobNumber: normalizedJobNumber,
        parts: [],
      });
    }

    const partNumbers = Array.from(totalsByPartNumber.keys());
    const parts = await prisma.part.findMany({
      where: { pn: { in: partNumbers } },
      select: {
        id: true,
        pn: true,
        nomenclature: true,
      },
    });
    const partsByPn = new Map(parts.map((p) => [p.pn, p]));

    const stockReturnLines = await prisma.jobStockReturnLine.findMany({
      where: {
        jobStockReturn: {
          jobNumber: normalizedJobNumber,
          status: 'ACTIVE',
        },
      },
      select: {
        partNumber: true,
        returnedQuantity: true,
      },
    });
    const returnedByPn = new Map<string, number>();
    for (const line of stockReturnLines) {
      const pn = line.partNumber?.trim();
      if (!pn) continue;
      returnedByPn.set(pn, (returnedByPn.get(pn) ?? 0) + (line.returnedQuantity ?? 0));
    }

    const resultParts = partNumbers.map((pn) => {
      const totals = totalsByPartNumber.get(pn) ?? {
        shopPulled: 0,
        vendorPulled: 0,
      };
      const totalPulled = totals.shopPulled + totals.vendorPulled;
      const alreadyReturned = returnedByPn.get(pn) ?? 0;
      const remainingPulled = Math.max(0, totalPulled - alreadyReturned);
      const part = partsByPn.get(pn);
      return {
        partId: part?.id ?? null,
        partNumber: pn,
        description: part?.nomenclature ?? null,
        shopPulled: totals.shopPulled,
        vendorPulled: totals.vendorPulled,
        alreadyReturned,
        totalPulled: remainingPulled,
      };
    }).filter((part) => part.totalPulled > 0);

    return NextResponse.json({
      jobNumber: normalizedJobNumber,
      parts: resultParts,
    });
  } catch (error) {
    console.error(
      'Error in /api/jobs/[jobNumber]/pulled-summary GET:',
      error
    );
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

