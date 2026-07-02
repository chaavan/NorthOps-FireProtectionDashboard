import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { MovementType } from '@prisma/client';
import { authOptions, resolveSessionUserIdForAudit } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { cache, cacheKeys } from '@/lib/cache';
import { formatDateInAppTimeZone } from '@/lib/timezone';
import { partNumberLookupVariants } from '@/lib/inventoryQuantity';
import { findPartRowByLookupVariants } from '@/lib/partsDatabase';
import { ORDER_CONTEXT_TYPE, recordOperationalDelta } from '@/lib/inventoryLedger';
import { isInventoryReplenishmentJobNumber, type InventoryPoLineItem } from '@/lib/inventoryReorder';
import { buildPoLineKey } from '@/lib/poLineKey';
import {
  buildPurchaseOrderCancellationEmailHtml,
  buildPurchaseOrderCancellationTextEmail,
} from '@/lib/email/templates/purchaseOrderCancellation';
import { requirePermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

type CancelReceiveItemInput = {
  jobNumber: string;
  listNumber?: string | null;
  partNumber: string;
};

type CancelReceiveStatus = 'CANCELLED' | 'EMAIL_FAILED' | 'BLOCKED' | 'NOT_FOUND';

type CancelReceiveResult = {
  jobNumber: string;
  listNumber: string | null;
  partNumber: string;
  status: CancelReceiveStatus;
  orderIds: string[];
  sendError?: string;
};

type MatchedPoLine = {
  orderId: string;
  orderNumber: string;
  vendorPoLabel: string | null;
  supplier: string | null;
  recipientTo: string[];
  recipientCc: string[];
  poItemQuantity: number;
};

function normalize(value: string | null | undefined): string {
  return String(value || '').trim();
}

function normalizeListNumber(value: string | null | undefined): string {
  const s = normalize(value);
  if (!s) return '';
  const num = parseInt(s, 10);
  return Number.isNaN(num) ? s : String(num);
}

function key(jobNumber: string, listNumber: string | null | undefined, partNumber: string): string {
  return `${normalize(jobNumber)}::${normalize(listNumber)}::${normalize(partNumber)}`;
}

/**
 * For purchase-order linkage matching, treat blank/missing listNumber as "1".
 * This aligns with the UI's defaulting behavior (listNumber || '1') and prevents
 * false BLOCKED results when PO items use list "1" but the job line listNumber is null/blank.
 */
function poKey(jobNumber: string, listNumber: string | null | undefined, partNumber: string): string {
  const normalized = normalizeListNumber(listNumber);
  const effective = normalized === '' ? '1' : normalized;
  return key(jobNumber, effective, partNumber);
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    const auth = await requirePermission(session, 'orders.cancel');
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const { items, disposition, skipEmails } = body as {
      items?: CancelReceiveItemInput[];
      disposition?: 'sendBackToInventory' | 'leaveAsIs';
      skipEmails?: boolean;
    };
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'No items provided' }, { status: 400 });
    }

    const normalizedItems = items
      .map((item) => ({
        jobNumber: normalize(item.jobNumber),
        listNumber: normalize(item.listNumber) || null,
        partNumber: normalize(item.partNumber),
      }))
      .filter((item) => item.jobNumber && item.partNumber);

    if (normalizedItems.length === 0) {
      return NextResponse.json({ error: 'No valid items provided' }, { status: 400 });
    }

    const actorUserId = await resolveSessionUserIdForAudit(session);

    const deduped = Array.from(new Map(normalizedItems.map((item) => [key(item.jobNumber, item.listNumber, item.partNumber), item])).values());
    const lineKeySet = new Set(deduped.map((item) => poKey(item.jobNumber, item.listNumber, item.partNumber)));
    const legacyLineKeySet = new Set(deduped.map((item) => `${item.jobNumber}::${item.partNumber}`));
    // When listNumber is blank/missing, we allow a fallback match by jobNumber+partNumber (ignoring list).
    const legacyUnknownListKeySet = new Set(
      deduped
        .filter((item) => normalizeListNumber(item.listNumber) === '')
        .map((item) => `${item.jobNumber}::${item.partNumber}`)
    );

    const allPurchaseOrders = await prisma.purchaseOrder.findMany({
      select: {
        id: true,
        orderNumber: true,
        vendorPoLabel: true,
        supplier: true,
        recipientTo: true,
        recipientCc: true,
        items: true,
      },
    });

    const matchedByLine = new Map<string, MatchedPoLine[]>();
    deduped.forEach((item) => matchedByLine.set(poKey(item.jobNumber, item.listNumber, item.partNumber), []));
    const matchedByLegacy = new Map<string, MatchedPoLine[]>();
    legacyLineKeySet.forEach((lk) => matchedByLegacy.set(lk, []));

    for (const po of allPurchaseOrders) {
      const poItems = (po.items || []) as Array<{
        jobNumber?: string;
        listNumber?: string | null;
        partNumber?: string;
        quantityOrdered?: number;
      }>;
      if (!Array.isArray(poItems)) continue;

      const recipientTo = Array.isArray(po.recipientTo) ? po.recipientTo.map((v) => normalize(String(v))).filter(Boolean) : [];
      const recipientCc = Array.isArray(po.recipientCc) ? po.recipientCc.map((v) => normalize(String(v))).filter(Boolean) : [];

      for (const poItem of poItems) {
        const poJob = normalize(poItem.jobNumber);
        const poPart = normalize(poItem.partNumber);
        if (!poJob || !poPart) continue;

        const poListNormalized = normalizeListNumber(poItem.listNumber);
        const poList = poListNormalized === '' ? null : poListNormalized;
        const exact = key(poJob, poList, poPart);
        const legacy = `${poJob}::${poPart}`;
        const isExactMatch = lineKeySet.has(exact);
        const isLegacyUnknownListMatch = legacyUnknownListKeySet.has(legacy);
        if (!isExactMatch && !isLegacyUnknownListMatch) continue;

        const matchedLineKeyMaybe = isExactMatch ? exact : null;
        if (matchedLineKeyMaybe && matchedByLine.has(matchedLineKeyMaybe)) {
          matchedByLine.get(matchedLineKeyMaybe)!.push({
            orderId: po.id,
            orderNumber: po.orderNumber,
            vendorPoLabel: po.vendorPoLabel ?? null,
            supplier: po.supplier ?? null,
            recipientTo,
            recipientCc,
            poItemQuantity: Math.max(0, Number(poItem.quantityOrdered || 0)),
          });
        } else if (isExactMatch) {
          // If exact list key doesn't exist (should be rare because lineKeySet is derived from request items),
          // fall back to a request-derived list key for the same job+part.
          const fallback = deduped.find((d) => d.jobNumber === poJob && d.partNumber === poPart);
          if (fallback) {
            const fallbackKey = poKey(fallback.jobNumber, fallback.listNumber, fallback.partNumber);
            if (matchedByLine.has(fallbackKey)) {
              matchedByLine.get(fallbackKey)!.push({
                orderId: po.id,
                orderNumber: po.orderNumber,
                vendorPoLabel: po.vendorPoLabel ?? null,
                supplier: po.supplier ?? null,
                recipientTo,
                recipientCc,
                poItemQuantity: Math.max(0, Number(poItem.quantityOrdered || 0)),
              });
            }
          }
        }

        if (isLegacyUnknownListMatch && matchedByLegacy.has(legacy)) {
          matchedByLegacy.get(legacy)!.push({
            orderId: po.id,
            orderNumber: po.orderNumber,
            vendorPoLabel: po.vendorPoLabel ?? null,
            supplier: po.supplier ?? null,
            recipientTo,
            recipientCc,
            poItemQuantity: Math.max(0, Number(poItem.quantityOrdered || 0)),
          });
        }
      }
    }

    const sentBy = (session.user as any).name || (session.user as any).email || 'Unknown';
    const now = new Date();
    const formattedDate = formatDateInAppTimeZone(now, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
    const webhookUrl = process.env.PURCHASE_ORDER_EMAIL_WEBHOOK_URL;
    const purchasingEmail = normalize(process.env.PURCHASING_FALLBACK_EMAIL || 'purchasing@totalfire.biz').toLowerCase();

    const results: CancelReceiveResult[] = [];
    const affectedJobNumbers = new Set<string>();
    let emailedCount = 0;
    let failedEmailCount = 0;

    for (const item of deduped) {
      const lineKey = poKey(item.jobNumber, item.listNumber, item.partNumber);

      if (isInventoryReplenishmentJobNumber(item.jobNumber)) {
        const matchedPoLines = matchedByLine.get(lineKey) || [];
        if (matchedPoLines.length === 0) {
          results.push({
            jobNumber: item.jobNumber,
            listNumber: item.listNumber,
            partNumber: item.partNumber,
            status: 'BLOCKED',
            orderIds: [],
            sendError: 'No purchase-order linkage found for selected line',
          });
          continue;
        }

        let hasEmailFailure = false;
        let combinedSendError: string | undefined;

        const poLineKey = buildPoLineKey(item.jobNumber, item.listNumber, item.partNumber);
        let qtyReceivedOnPo = 0;
        let totalQtyFromPO = 0;
        let lineDescription: string | null = null;
        for (const line of matchedPoLines) {
          totalQtyFromPO += line.poItemQuantity;
          const po = await prisma.purchaseOrder.findUnique({
            where: { id: line.orderId },
            select: { items: true, orderNumber: true },
          });
          if (!po || !Array.isArray(po.items)) continue;
          for (const pi of po.items as InventoryPoLineItem[]) {
            if (pi.cancelled === true) continue;
            const pk = buildPoLineKey(pi.jobNumber, pi.listNumber, pi.partNumber);
            if (pk !== poLineKey) continue;
            qtyReceivedOnPo = Math.max(qtyReceivedOnPo, Number(pi.quantityReceived ?? 0));
            if (pi.description && !lineDescription) lineDescription = pi.description;
          }
        }

        const isFullyReceived = totalQtyFromPO > 0 && qtyReceivedOnPo >= totalQtyFromPO;

        if (!skipEmails && !isFullyReceived) {
          if (!webhookUrl) {
            hasEmailFailure = true;
            combinedSendError = 'PURCHASE_ORDER_EMAIL_WEBHOOK_URL not set';
          } else {
            const poGroups = new Map<string, {
              orderId: string;
              orderNumber: string;
              vendorPoLabel: string;
              supplier: string;
              recipientTo: string[];
              recipientCc: string[];
              cancelledItems: Array<{ partNumber: string; description: string | null; quantityOrdered: number }>;
            }>();
            matchedPoLines.forEach((line) => {
              if (!poGroups.has(line.orderId)) {
                const to = line.recipientTo.length > 0 ? [...new Set(line.recipientTo)] : [purchasingEmail];
                const cc = [...new Set([...line.recipientCc, purchasingEmail])];
                poGroups.set(line.orderId, {
                  orderId: line.orderId,
                  orderNumber: line.orderNumber,
                  vendorPoLabel: normalize(line.vendorPoLabel) || line.orderNumber,
                  supplier: normalize(line.supplier) || 'Unknown Supplier',
                  recipientTo: to,
                  recipientCc: cc,
                  cancelledItems: [],
                });
              }
              poGroups.get(line.orderId)!.cancelledItems.push({
                partNumber: item.partNumber,
                description: lineDescription,
                quantityOrdered: line.poItemQuantity > 0 ? line.poItemQuantity : 1,
              });
            });
            for (const group of poGroups.values()) {
              try {
                const htmlBody = buildPurchaseOrderCancellationEmailHtml({
                  vendorPoLabel: group.vendorPoLabel,
                  orderNumber: group.orderNumber,
                  supplierName: group.supplier,
                  sentBy,
                  formattedDate,
                  cancelledItems: group.cancelledItems,
                });
                const textBody = buildPurchaseOrderCancellationTextEmail({
                  vendorPoLabel: group.vendorPoLabel,
                  orderNumber: group.orderNumber,
                  supplierName: group.supplier,
                  sentBy,
                  formattedDate,
                  cancelledItems: group.cancelledItems,
                });
                const response = await fetch(webhookUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    action: 'cancel_order',
                    subject: `Total Fire Protection Order Cancellation | ${group.vendorPoLabel} | ${group.supplier}`,
                    to: group.recipientTo.join(','),
                    cc: group.recipientCc.join(','),
                    orderNumber: group.orderNumber,
                    vendorPoLabel: group.vendorPoLabel,
                    supplier: group.supplier,
                    cancelledItems: group.cancelledItems,
                    sentBy,
                    sentAt: now.toISOString(),
                    htmlBody,
                    textBody,
                  }),
                });
                if (!response.ok) {
                  const details = await response.text();
                  hasEmailFailure = true;
                  combinedSendError = `Webhook returned ${response.status}: ${details || response.statusText}`;
                } else {
                  emailedCount += 1;
                }
              } catch (error) {
                hasEmailFailure = true;
                combinedSendError = (error as Error).message;
              }
            }
            if (hasEmailFailure) failedEmailCount += 1;
          }
        }

        const effectiveDisposition =
          isFullyReceived && disposition ? disposition : 'sendBackToInventory';

        if (isFullyReceived && effectiveDisposition === 'sendBackToInventory' && qtyReceivedOnPo > 0) {
          await prisma.$transaction(async (tx) => {
            const part = await findPartRowByLookupVariants(
              partNumberLookupVariants(item.partNumber),
              tx,
            );
            if (!part) return;
            const primaryOrderId = matchedPoLines[0]?.orderId?.trim() || 'unknown';
            await recordOperationalDelta(tx, {
              partId: part.id,
              signedDelta: -qtyReceivedOnPo,
              movementType: MovementType.PULL,
              contextType: ORDER_CONTEXT_TYPE,
              contextId: primaryOrderId,
              actorUserId,
              note: `Reverse inventory PO receive | PN ${item.partNumber}`,
            });
          });
        }

        for (const line of matchedPoLines) {
          const po = await prisma.purchaseOrder.findUnique({
            where: { id: line.orderId },
            select: { items: true },
          });
          if (!po || !Array.isArray(po.items)) continue;
          const updated = (po.items as InventoryPoLineItem[]).map((pi) => {
            const pk = buildPoLineKey(pi.jobNumber, pi.listNumber, pi.partNumber);
            if (pk !== poLineKey) return pi;
            return { ...pi, cancelled: true, quantityReceived: 0, fullyReceived: false };
          });
          await prisma.purchaseOrder.update({
            where: { id: line.orderId },
            data: { items: updated },
          });
        }

        results.push({
          jobNumber: item.jobNumber,
          listNumber: item.listNumber,
          partNumber: item.partNumber,
          status: hasEmailFailure ? 'EMAIL_FAILED' : 'CANCELLED',
          orderIds: [...new Set(matchedPoLines.map((l) => l.orderId))],
          sendError: combinedSendError,
        });
        continue;
      }

      let matchedPoLines = matchedByLine.get(lineKey) || [];

      const currentRow = item.listNumber
        ? await prisma.job.findUnique({
            where: {
              jobNumber_listNumber_partNumber: {
                jobNumber: item.jobNumber,
                listNumber: item.listNumber,
                partNumber: item.partNumber,
              },
            },
            select: {
              jobNumber: true,
              listNumber: true,
              partNumber: true,
              description: true,
              quantityReceivedFromOrder: true,
              receivedFromOrder: true,
            },
          })
        : await prisma.job.findFirst({
            where: {
              jobNumber: item.jobNumber,
              partNumber: item.partNumber,
            },
            select: {
              jobNumber: true,
              listNumber: true,
              partNumber: true,
              description: true,
              quantityReceivedFromOrder: true,
              receivedFromOrder: true,
            },
          });

      if (!currentRow) {
        results.push({
          jobNumber: item.jobNumber,
          listNumber: item.listNumber,
          partNumber: item.partNumber,
          status: 'NOT_FOUND',
          orderIds: [],
          sendError: 'Job line not found',
        });
        continue;
      }

      // If the request listNumber was blank, also use legacy matches (job+part, ignoring listNumber)
      // when exact list matching found nothing.
      const unknownList = normalizeListNumber(item.listNumber) === '';
      if (matchedPoLines.length === 0 && unknownList) {
        matchedPoLines = matchedByLegacy.get(`${item.jobNumber}::${item.partNumber}`) || [];
      }

      if (matchedPoLines.length === 0) {
        results.push({
          jobNumber: currentRow.jobNumber,
          listNumber: currentRow.listNumber,
          partNumber: currentRow.partNumber,
          status: 'BLOCKED',
          orderIds: [],
          sendError: 'No purchase-order linkage found for selected line',
        });
        continue;
      }

      const totalQtyFromPO = matchedPoLines.reduce((sum, l) => sum + l.poItemQuantity, 0);
      const qtyReceived = currentRow.quantityReceivedFromOrder ?? 0;
      const isFullyReceived = totalQtyFromPO > 0 && qtyReceived >= totalQtyFromPO;

      // Only send cancellation emails for items NOT yet received
      // Received items: no email (vendor already delivered; we're just managing internal state)
      // skipEmails: when true (all selected are received), never send
      let hasEmailFailure = false;
      let combinedSendError: string | undefined;

      if (!skipEmails && !isFullyReceived) {
        const poGroups = new Map<string, {
          orderId: string;
          orderNumber: string;
          vendorPoLabel: string;
          supplier: string;
          recipientTo: string[];
          recipientCc: string[];
          cancelledItems: Array<{ partNumber: string; description: string | null; quantityOrdered: number }>;
        }>();

        matchedPoLines.forEach((line) => {
          const groupKey = line.orderId;
          if (!poGroups.has(groupKey)) {
            const to = line.recipientTo.length > 0 ? [...new Set(line.recipientTo)] : [purchasingEmail];
            const cc = [...new Set([...line.recipientCc, purchasingEmail])];
            poGroups.set(groupKey, {
              orderId: line.orderId,
              orderNumber: line.orderNumber,
              vendorPoLabel: normalize(line.vendorPoLabel) || line.orderNumber,
              supplier: normalize(line.supplier) || 'Unknown Supplier',
              recipientTo: to,
              recipientCc: cc,
              cancelledItems: [],
            });
          }
          const group = poGroups.get(groupKey)!;
          group.cancelledItems.push({
            partNumber: currentRow.partNumber,
            description: currentRow.description,
            quantityOrdered: line.poItemQuantity > 0 ? line.poItemQuantity : 1,
          });
        });

        if (!webhookUrl) {
          hasEmailFailure = true;
          combinedSendError = 'PURCHASE_ORDER_EMAIL_WEBHOOK_URL not set';
        } else {
          for (const group of poGroups.values()) {
            try {
              const htmlBody = buildPurchaseOrderCancellationEmailHtml({
                vendorPoLabel: group.vendorPoLabel,
                orderNumber: group.orderNumber,
                supplierName: group.supplier,
                sentBy,
                formattedDate,
                cancelledItems: group.cancelledItems,
              });
              const textBody = buildPurchaseOrderCancellationTextEmail({
                vendorPoLabel: group.vendorPoLabel,
                orderNumber: group.orderNumber,
                supplierName: group.supplier,
                sentBy,
                formattedDate,
                cancelledItems: group.cancelledItems,
              });

              const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  action: 'cancel_order',
                  subject: `Total Fire Protection Order Cancellation | ${group.vendorPoLabel} | ${group.supplier}`,
                  to: group.recipientTo.join(','),
                  cc: group.recipientCc.join(','),
                  orderNumber: group.orderNumber,
                  vendorPoLabel: group.vendorPoLabel,
                  supplier: group.supplier,
                  cancelledItems: group.cancelledItems,
                  sentBy,
                  sentAt: now.toISOString(),
                  htmlBody,
                  textBody,
                }),
              });

              if (!response.ok) {
                const details = await response.text();
                hasEmailFailure = true;
                combinedSendError = `Webhook returned ${response.status}: ${details || response.statusText}`;
              } else {
                emailedCount += 1;
              }
            } catch (error) {
              hasEmailFailure = true;
              combinedSendError = (error as Error).message;
            }
          }
        }

        if (hasEmailFailure) {
          failedEmailCount += 1;
        }
      }

      const effectiveDisposition =
        isFullyReceived && disposition ? disposition : 'sendBackToInventory';

      if (!isFullyReceived) {
        await prisma.job.update({
          where: {
            jobNumber_listNumber_partNumber: {
              jobNumber: currentRow.jobNumber,
              listNumber: currentRow.listNumber,
              partNumber: currentRow.partNumber,
            },
          },
          data: {
            ordered: false,
            quantityOrdered: null,
            quantityReceivedFromOrder: 0,
            receivedFromOrder: false,
            pickupFromSupplier: false,
            supplierDeliveryToJobsite: false,
            updatedAt: new Date(),
          },
        });
      } else if (effectiveDisposition === 'sendBackToInventory') {
        const toUnpull = Math.min(totalQtyFromPO, qtyReceived);
        const primaryOrderId = matchedPoLines[0]?.orderId?.trim() || 'unknown';
        await prisma.$transaction(async (tx) => {
          await tx.job.update({
            where: {
              jobNumber_listNumber_partNumber: {
                jobNumber: currentRow.jobNumber,
                listNumber: currentRow.listNumber,
                partNumber: currentRow.partNumber,
              },
            },
            data: {
              ordered: false,
              quantityOrdered: null,
              quantityReceivedFromOrder: 0,
              receivedFromOrder: false,
              pickupFromSupplier: false,
              supplierDeliveryToJobsite: false,
              updatedAt: new Date(),
            },
          });

          if (toUnpull <= 0) return;

          const part = await findPartRowByLookupVariants(
            partNumberLookupVariants(currentRow.partNumber),
            tx,
          );
          if (!part) {
            if (process.env.NODE_ENV === 'development') {
              console.warn(
                `[cancel-receive] Part not found for ${currentRow.partNumber}, skipping inventory return`,
              );
            }
            return;
          }

          await recordOperationalDelta(tx, {
            partId: part.id,
            signedDelta: toUnpull,
            movementType: MovementType.UNPULL,
            contextType: ORDER_CONTEXT_TYPE,
            contextId: primaryOrderId,
            actorUserId,
            note: `Return to inventory: cancel receive | job ${currentRow.jobNumber} | PN ${currentRow.partNumber}`,
          });
        });
      } else {
        await prisma.job.update({
          where: {
            jobNumber_listNumber_partNumber: {
              jobNumber: currentRow.jobNumber,
              listNumber: currentRow.listNumber,
              partNumber: currentRow.partNumber,
            },
          },
          data: {
            ordered: false,
            quantityOrdered: null,
            pickupFromSupplier: false,
            supplierDeliveryToJobsite: false,
            updatedAt: new Date(),
          },
        });
      }

      for (const line of matchedPoLines) {
        const po = await prisma.purchaseOrder.findUnique({
          where: { id: line.orderId },
          select: { items: true },
        });
        if (!po || !Array.isArray(po.items)) continue;
        const poItems = po.items as Array<{
          jobNumber?: string;
          listNumber?: string | null;
          partNumber?: string;
          quantityOrdered?: number;
          cancelled?: boolean;
        }>;
        const updated = poItems.map((pi) => {
          const pj = normalize(pi.jobNumber);
          const pp = normalize(pi.partNumber);
          const pl = normalize(pi.listNumber) || null;
          const matches =
            pj === currentRow.jobNumber &&
            pp === currentRow.partNumber &&
            (pl === currentRow.listNumber ||
              (!pl && !currentRow.listNumber) ||
              (currentRow.listNumber && pl === currentRow.listNumber));
          if (matches) return { ...pi, cancelled: true };
          return pi;
        });
        await prisma.purchaseOrder.update({
          where: { id: line.orderId },
          data: { items: updated },
        });
      }

      affectedJobNumbers.add(currentRow.jobNumber);
      results.push({
        jobNumber: currentRow.jobNumber,
        listNumber: currentRow.listNumber,
        partNumber: currentRow.partNumber,
        status: hasEmailFailure ? 'EMAIL_FAILED' : 'CANCELLED',
        orderIds: [...new Set(matchedPoLines.map((line) => line.orderId))],
        sendError: combinedSendError,
      });
    }

    affectedJobNumbers.forEach((jobNumber) => {
      cache.delete(cacheKeys.jobDetails(jobNumber));
    });
    cache.delete(cacheKeys.jobsList());
    cache.delete(cacheKeys.calendar());

    const cancelledCount = results.filter((r) => r.status === 'CANCELLED' || r.status === 'EMAIL_FAILED').length;
    const blockedCount = results.filter((r) => r.status === 'BLOCKED').length;
    const notFoundCount = results.filter((r) => r.status === 'NOT_FOUND').length;

    return NextResponse.json({
      success: blockedCount === 0 && notFoundCount === 0 && failedEmailCount === 0,
      cancelledCount,
      emailedCount,
      failedEmailCount,
      blockedCount,
      notFoundCount,
      results,
    });
  } catch (error) {
    console.error('Error in /api/admin/orders/cancel-receive:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
