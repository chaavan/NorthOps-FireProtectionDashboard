import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requirePermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/parts
 * Returns paginated list of parts with quantityOnHand and reorderPoint
 * Supports search by part number, supplier part number, and description
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

    const auth = await requirePermission(session, 'inventory.view');
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const search = searchParams.get('search') || '';
    const lowStock = searchParams.get('lowStock') === '1';
    const skip = (page - 1) * limit;

    const totalValueResult = await prisma.$queryRaw<Array<{ total: string | null }>>`
      SELECT COALESCE(SUM("cost" * COALESCE("quantity", 0)), 0) AS total
      FROM "parts"
    `;
    const totalInventoryValue = Number(totalValueResult[0]?.total ?? 0);

    if (lowStock) {
      const searchFilter = search
        ? Prisma.sql`AND (
            "pn" ILIKE ${'%' + search + '%'}
            OR "nomenclature" ILIKE ${'%' + search + '%'}
            OR "vendor_part_id" ILIKE ${'%' + search + '%'}
            OR "altPN" ILIKE ${'%' + search + '%'}
          )`
        : Prisma.empty;

      const totalResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM "parts"
        WHERE "reorder_point" > 0
          AND "order_minimum" > 0
          AND COALESCE("quantity", 0) <= "reorder_point"
          ${searchFilter}
      `;
      const total = Number(totalResult[0]?.count ?? 0);

      const rawParts = await prisma.$queryRaw<Array<{
        id: string;
        pn: string;
        nomenclature: string;
        quantity: bigint | null;
        reorder_point: number | null;
        order_minimum: number | null;
        units: string;
        vendor: string | null;
        cost: Prisma.Decimal;
        updatedAt: Date;
        altPN: string | null;
        vendor_part_id: string | null;
      }>>`
        SELECT
          "id", "pn", "nomenclature", "quantity", "reorder_point", "order_minimum",
          "units", "vendor", "cost", "updatedAt", "altPN", "vendor_part_id"
        FROM "parts"
        WHERE "reorder_point" > 0
          AND "order_minimum" > 0
          AND COALESCE("quantity", 0) <= "reorder_point"
          ${searchFilter}
        ORDER BY "pn" ASC
        LIMIT ${limit}
        OFFSET ${skip}
      `;

      return NextResponse.json({
        parts: rawParts.map((p) => ({
          id: p.id,
          pn: p.pn,
          nomenclature: p.nomenclature,
          quantity: p.quantity ? Number(p.quantity) : 0,
          reorderPoint: p.reorder_point,
          orderMinimum: p.order_minimum,
          units: p.units,
          vendor: p.vendor,
          cost: Number(p.cost),
          updatedAt: p.updatedAt,
          altPN: p.altPN,
          vendorPartID: p.vendor_part_id,
        })),
        totalInventoryValue,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    }

    // Build where clause
    const where: any = {};
    if (search) {
      where.OR = [
        { pn: { contains: search, mode: 'insensitive' } },
        { nomenclature: { contains: search, mode: 'insensitive' } },
        { vendorPartID: { contains: search, mode: 'insensitive' } },
        { altPN: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Get total count
    const total = await prisma.part.count({ where });

    // Get parts
    const parts = await prisma.part.findMany({
      where,
      skip,
      take: limit,
      orderBy: [
        { pn: 'asc' },
      ],
      select: {
        id: true,
        pn: true,
        nomenclature: true,
        quantity: true,
        reorderPoint: true,
        orderMinimum: true,
        units: true,
        vendor: true,
        cost: true,
        updatedAt: true,
        altPN: true,
        vendorPartID: true,
      },
    });

    return NextResponse.json({
      parts: parts.map(p => ({
        ...p,
        quantity: p.quantity ? Number(p.quantity) : 0,
        cost: Number(p.cost),
      })),
      totalInventoryValue,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error in /api/admin/parts GET:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
