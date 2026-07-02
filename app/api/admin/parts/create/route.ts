import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, resolveSessionUserIdForAudit } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/permissions';
import { formatDateInAppTimeZone } from '@/lib/timezone';
import { normalizePartNumber, parseNonNegativeInt } from '@/lib/inventoryQuantity';
import { COST_CONTEXT_MANUAL, recordPartCostChange } from '@/lib/partCostLedger';
import { INFO_CONTEXT_MANUAL, openingProfileDiffs, openingThresholdDiffs, recordPartInfoChange } from '@/lib/partInfoLedger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/parts/create
 * Creates a new part (Admin only)
 * Body: { pn, nomenclature, units, cost, company, whse, type, initialQuantity, reorderPoint, orderMinimum, vendor, altPN, vendorPartID }
 */
export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json(
                { error: 'Unauthorized - Please sign in' },
                { status: 401 }
            );
        }

        const auth = await requirePermission(session, 'inventory.add_part');
        if (!auth.ok) return auth.response;

        const body = await request.json();
        const {
            pn,
            nomenclature,
            units,
            cost,
            company,
            whse,
            type,
            initialQuantity,
            reorderPoint,
            orderMinimum,
            vendor,
            altPN,
            vendorPartID
        } = body;

        // Validation
        if (!pn || !nomenclature || !units || !vendor || cost === undefined) {
            return NextResponse.json(
                { error: 'Part number, nomenclature, units, vendor, and cost are required' },
                { status: 400 }
            );
        }

        const costNum = Number(cost);

        if (isNaN(costNum) || !Number.isFinite(costNum) || costNum < 0) {
            return NextResponse.json(
                { error: 'Cost must be a valid number >= 0' },
                { status: 400 }
            );
        }

        const initialQtyParsed = parseNonNegativeInt(
            initialQuantity === '' || initialQuantity === null || initialQuantity === undefined
                ? 0
                : initialQuantity,
            'initialQuantity'
        );
        if (!initialQtyParsed.ok) {
            return NextResponse.json(
                { error: initialQtyParsed.error },
                { status: 400 }
            );
        }

        const reorderPointParsed = parseNonNegativeInt(reorderPoint, 'reorderPoint');
        if (!reorderPointParsed.ok) {
            return NextResponse.json(
                { error: reorderPointParsed.error },
                { status: 400 }
            );
        }
        if (reorderPointParsed.value <= 0) {
            return NextResponse.json(
                { error: 'Minimum On Hand must be greater than 0' },
                { status: 400 }
            );
        }

        const orderMinimumParsed = parseNonNegativeInt(orderMinimum, 'orderMinimum');
        if (!orderMinimumParsed.ok) {
            return NextResponse.json(
                { error: orderMinimumParsed.error },
                { status: 400 }
            );
        }
        if (orderMinimumParsed.value <= 0) {
            return NextResponse.json(
                { error: 'Order Minimum must be greater than 0' },
                { status: 400 }
            );
        }

        const normalizedPn = normalizePartNumber(pn);
        if (!normalizedPn) {
            return NextResponse.json(
                { error: 'Part number is invalid' },
                { status: 400 }
            );
        }

        // Check if part number already exists
        const existingPart = await prisma.part.findFirst({
            where: {
                pn: {
                    equals: normalizedPn,
                    mode: 'insensitive'
                }
            }
        });

        if (existingPart) {
            return NextResponse.json(
                { error: 'DUPLICATE_PN', message: `Part number "${pn}" already exists` },
                { status: 409 }
            );
        }

        const actorUserId = await resolveSessionUserIdForAudit(session);

        const newPart = await prisma.$transaction(async (tx) => {
            const row = await tx.part.create({
                data: {
                    // Canonical PN format for all quantity writes/lookups.
                    // This reduces mismatches caused by spaces/casing variance.
                    pn: normalizedPn,
                    nomenclature: nomenclature.trim(),
                    units: units.trim(),
                    cost: costNum,
                    company: company ? Number(company) : 2,
                    whse: whse ? Number(whse) : 1,
                    type: type ? Number(type) : 1,
                    quantity: BigInt(initialQtyParsed.value),
                    reorderPoint: reorderPointParsed.value,
                    orderMinimum: orderMinimumParsed.value,
                    vendor: vendor || null,
                    altPN: altPN || null,
                    vendorPartID: vendorPartID || null,
                    dateUpdated: formatDateInAppTimeZone(new Date()),
                },
            });

            await recordPartCostChange(tx, {
                partId: row.id,
                costBefore: null,
                costAfter: costNum,
                actorUserId,
                contextType: COST_CONTEXT_MANUAL,
                contextId: `part-create:${row.id}`,
                note: `Part created (opening catalog cost ${costNum.toFixed(2)}).`,
            });

            await recordPartInfoChange(tx, {
                partId: row.id,
                actorUserId,
                contextType: INFO_CONTEXT_MANUAL,
                contextId: `part-create:${row.id}`,
                diffs: [
                    ...openingProfileDiffs({
                        pn: row.pn,
                        nomenclature: row.nomenclature,
                        units: row.units,
                        vendor: row.vendor,
                        vendorPartID: row.vendorPartID,
                    }),
                    ...openingThresholdDiffs({
                        reorderPoint: row.reorderPoint,
                        orderMinimum: row.orderMinimum,
                    }),
                ],
                note: 'Part created (opening profile).',
            });

            return row;
        });

        return NextResponse.json({
            success: true,
            part: {
                ...newPart,
                quantity: Number(newPart.quantity),
            },
        });
    } catch (error) {
        console.error('Error in /api/admin/parts/create POST:', error);
        return NextResponse.json(
            { error: (error as Error).message },
            { status: 500 }
        );
    }
}
