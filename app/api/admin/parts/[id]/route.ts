import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, resolveSessionUserIdForAudit } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/permissions';
import { formatDateInAppTimeZone } from '@/lib/timezone';
import { catalogCostsEqual, COST_CONTEXT_MANUAL, recordPartCostChange } from '@/lib/partCostLedger';
import {
  collectPartProfileDiffs,
  collectPartThresholdDiffs,
  INFO_CONTEXT_MANUAL,
  recordPartInfoChange,
} from '@/lib/partInfoLedger';
import { parseNonNegativeInt } from '@/lib/inventoryQuantity';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/admin/parts/[id]
 * Updates an existing part (Admin only)
 * Body: { pn, nomenclature, units, cost, vendor, vendorPartID, reorderPoint, orderMinimum } — altPN is not updated via this route.
 */
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json(
                { error: 'Unauthorized - Please sign in' },
                { status: 401 }
            );
        }

        const auth = await requirePermission(session, 'inventory.edit_part');
        if (!auth.ok) return auth.response;

        const { id } = await params;
        if (!id) {
            return NextResponse.json(
                { error: 'Part ID is required' },
                { status: 400 }
            );
        }

        const body = await request.json();
        const {
            pn,
            nomenclature,
            units,
            cost,
            vendor,
            vendorPartID,
            reorderPoint,
            orderMinimum,
        } = body;

        // Validation
        if (!pn || !nomenclature || !units || !vendor || cost === undefined) {
            return NextResponse.json(
                { error: 'Part number, nomenclature, units, vendor, and cost are required' },
                { status: 400 }
            );
        }

        const costNum = Number(cost);

        if (isNaN(costNum)) {
            return NextResponse.json(
                { error: 'Cost must be a valid number' },
                { status: 400 }
            );
        }

        // Check if part exists
        const existingPart = await prisma.part.findUnique({
            where: { id }
        });

        if (!existingPart) {
            return NextResponse.json(
                { error: 'Part not found' },
                { status: 404 }
            );
        }

        // Check if new PN conflicts with another part (if PN is being changed)
        if (pn.trim().toLowerCase() !== existingPart.pn.toLowerCase()) {
            const duplicatePart = await prisma.part.findFirst({
                where: {
                    pn: {
                        equals: pn.trim(),
                        mode: 'insensitive'
                    },
                    id: {
                        not: id
                    }
                }
            });

            if (duplicatePart) {
                return NextResponse.json(
                    { error: 'DUPLICATE_PN', message: `Part number "${pn}" already exists` },
                    { status: 409 }
                );
            }
        }

        const actorUserId = await resolveSessionUserIdForAudit(session);
        const oldCost = existingPart.cost;

        const beforeProfile = {
            pn: existingPart.pn,
            nomenclature: existingPart.nomenclature,
            units: existingPart.units,
            vendor: existingPart.vendor,
            vendorPartID: existingPart.vendorPartID,
        };
        const afterProfile = {
            pn: pn.trim(),
            nomenclature: nomenclature.trim(),
            units: units.trim(),
            vendor: vendor?.trim() || null,
            vendorPartID: vendorPartID?.trim() || null,
        };
        const profileDiffs = collectPartProfileDiffs(beforeProfile, afterProfile);

        let nextReorderPoint: number | null = existingPart.reorderPoint;
        let nextOrderMinimum: number | null = existingPart.orderMinimum;
        if (reorderPoint !== undefined) {
            if (reorderPoint === null || reorderPoint === '') {
                nextReorderPoint = null;
            } else {
                const parsed = parseNonNegativeInt(reorderPoint, 'reorderPoint');
                if (!parsed.ok) {
                    return NextResponse.json({ error: parsed.error }, { status: 400 });
                }
                nextReorderPoint = parsed.value > 0 ? parsed.value : null;
            }
        }
        if (orderMinimum !== undefined) {
            if (orderMinimum === null || orderMinimum === '') {
                nextOrderMinimum = null;
            } else {
                const parsed = parseNonNegativeInt(orderMinimum, 'orderMinimum');
                if (!parsed.ok) {
                    return NextResponse.json({ error: parsed.error }, { status: 400 });
                }
                nextOrderMinimum = parsed.value > 0 ? parsed.value : null;
            }
        }

        const thresholdDiffs = collectPartThresholdDiffs(
            {
                reorderPoint: existingPart.reorderPoint,
                orderMinimum: existingPart.orderMinimum,
            },
            {
                reorderPoint: nextReorderPoint,
                orderMinimum: nextOrderMinimum,
            },
        );
        const allInfoDiffs = [...profileDiffs, ...thresholdDiffs];

        const updatedPart = await prisma.$transaction(async (tx) => {
            const row = await tx.part.update({
                where: { id },
                data: {
                    pn: afterProfile.pn,
                    nomenclature: afterProfile.nomenclature,
                    units: afterProfile.units,
                    cost: costNum,
                    vendor: afterProfile.vendor,
                    vendorPartID: afterProfile.vendorPartID,
                    reorderPoint: nextReorderPoint,
                    orderMinimum: nextOrderMinimum,
                    dateUpdated: formatDateInAppTimeZone(new Date()),
                },
            });

            if (!catalogCostsEqual(oldCost, costNum)) {
                await recordPartCostChange(tx, {
                    partId: id,
                    costBefore: oldCost,
                    costAfter: costNum,
                    actorUserId,
                    contextType: COST_CONTEXT_MANUAL,
                    contextId: actorUserId ? `manual:${actorUserId}:${Date.now()}` : `manual:unknown:${Date.now()}`,
                    note: `Catalog cost ${Number(oldCost).toFixed(2)} → ${costNum.toFixed(2)}.`,
                });
            }

            if (allInfoDiffs.length > 0) {
                const ctx = Date.now();
                await recordPartInfoChange(tx, {
                    partId: id,
                    actorUserId,
                    contextType: INFO_CONTEXT_MANUAL,
                    contextId: actorUserId ? `manual:${actorUserId}:${ctx}` : `manual:unknown:${ctx}`,
                    diffs: allInfoDiffs,
                    note: `${allInfoDiffs.length} profile field(s) updated.`,
                });
            }

            return row;
        });

        return NextResponse.json({
            success: true,
            part: {
                ...updatedPart,
                quantity: Number(updatedPart.quantity),
            },
        });
    } catch (error) {
        console.error('Error in /api/admin/parts/[id] PUT:', error);
        return NextResponse.json(
            { error: (error as Error).message },
            { status: 500 }
        );
    }
}

/**
 * GET /api/admin/parts/[id]
 * Get a single part by ID
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json(
                { error: 'Unauthorized - Please sign in' },
                { status: 401 }
            );
        }

        const { id } = await params;
        if (!id) {
            return NextResponse.json(
                { error: 'Part ID is required' },
                { status: 400 }
            );
        }

        const part = await prisma.part.findUnique({
            where: { id }
        });

        if (!part) {
            return NextResponse.json(
                { error: 'Part not found' },
                { status: 404 }
            );
        }

        return NextResponse.json({
            part: {
                ...part,
                quantity: Number(part.quantity),
            },
        });
    } catch (error) {
        console.error('Error in /api/admin/parts/[id] GET:', error);
        return NextResponse.json(
            { error: (error as Error).message },
            { status: 500 }
        );
    }
}

/**
 * DELETE /api/admin/parts/[id]
 * Deletes an existing part when it is no longer required (Admin only)
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json(
                { error: 'Unauthorized - Please sign in' },
                { status: 401 }
            );
        }

        const auth = await requirePermission(session, 'inventory.delete_part');
        if (!auth.ok) return auth.response;

        const { id } = await params;
        if (!id) {
            return NextResponse.json(
                { error: 'Part ID is required' },
                { status: 400 }
            );
        }

        const existingPart = await prisma.part.findUnique({
            where: { id },
            select: { id: true, pn: true },
        });

        if (!existingPart) {
            return NextResponse.json(
                { error: 'Part not found' },
                { status: 404 }
            );
        }

        // Prevent deleting parts that are still tied to active jobs.
        const activeJobReferences = await prisma.job.count({
            where: {
                partNumber: existingPart.pn,
                OR: [{ delivered: false }, { delivered: null }],
            },
        });

        if (activeJobReferences > 0) {
            return NextResponse.json(
                {
                    error: 'PART_IN_USE',
                    message: `Cannot delete part "${existingPart.pn}" because it is used by ${activeJobReferences} active job line(s).`,
                },
                { status: 409 }
            );
        }

        await prisma.part.delete({
            where: { id },
        });

        return NextResponse.json({
            success: true,
            deletedPartId: id,
            message: `Part "${existingPart.pn}" deleted successfully.`,
        });
    } catch (error) {
        console.error('Error in /api/admin/parts/[id] DELETE:', error);
        return NextResponse.json(
            { error: (error as Error).message },
            { status: 500 }
        );
    }
}
