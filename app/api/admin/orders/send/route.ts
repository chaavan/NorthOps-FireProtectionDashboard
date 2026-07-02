import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { displaySupplierName, normalizeSupplierKey, parseEmailList } from '@/lib/suppliers';
import { getPricingForParts } from '@/lib/partsDatabase';
import {
  formatDateInAppTimeZone,
  getAppTimeZoneDayBounds,
  toDateKeyInAppTimeZone,
} from '@/lib/timezone';
import { buildPurchaseOrderEmailHtml } from '@/lib/email/templates/purchaseOrder';
import {
  INVENTORY_REORDER_JOB_NAME,
  INVENTORY_REORDER_LIST_NUMBER,
  isInventoryReplenishmentJobNumber,
} from '@/lib/inventoryReorder';
import { requirePermission } from '@/lib/permissions';
import { getVendorDirectoryByKeys } from '@/lib/vendorService';
import { sendPurchaseOrderWebhook } from '@/lib/purchaseOrderWebhook';

export const dynamic = 'force-dynamic';

interface OrderItem {
  jobNumber: string;
  listNumber?: string | null;
  jobName: string;
  partNumber: string;
  description: string | null;
  uom?: string | null;
  quantityOrdered: number;
  supplier?: string | null;
  vendor?: string | null;
  unitCostSnapshot?: number | null;
}

function ensurePositiveQuantity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  return Math.floor(value);
}

type SupplierResult = {
  supplier: string;
  orderNumber: string;
  vendorPoLabel: string;
  recipientTo: string[];
  recipientCc: string[];
  itemCount: number;
  sendStatus: 'SENT' | 'FAILED';
  sendError: string | null;
  fallbackToPurchasing: boolean;
  emailDispatched: boolean;
};

type JobLabelContext = {
  jobNumber: string;
  listNumber: string;
  jobName: string;
  area: string | null;
};

function normalizeLabelText(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeJobListKey(jobNumber: string, listNumber: string | null | undefined): string {
  const normalizedList = normalizeLabelText(listNumber) || '1';
  return `${normalizeLabelText(jobNumber)}::${normalizedList}`;
}

function normalizeListNumber(value: string | null | undefined): string {
  const s = String(value ?? '').trim();
  if (!s) return '1';
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? s : String(n);
}

function compareJobListKey(a: string, b: string): number {
  const [jobA, listA] = a.split('::');
  const [jobB, listB] = b.split('::');
  const byJob = jobA.localeCompare(jobB);
  if (byJob !== 0) return byJob;
  return listA.localeCompare(listB);
}

function buildVendorPoLabel(primaryContext: JobLabelContext, isMulti: boolean, supplierName: string): string {
  const prefix = `${normalizeLabelText(primaryContext.jobNumber)}-${normalizeLabelText(primaryContext.listNumber) || '1'}`;
  let jobName = normalizeLabelText(primaryContext.jobName) || 'Unknown Job';
  let area = normalizeLabelText(primaryContext.area || '');
  const supplierSuffix = ` - ${normalizeLabelText(supplierName) || 'Unknown Supplier'}`;
  const multiSuffix = isMulti ? ' +MULTI' : '';
  const maxLabelLength = 140;

  const compose = (name: string, areaValue: string) => {
    let label = `${prefix} ${name}`;
    if (areaValue) {
      label += ` - ${areaValue}`;
    }
    label += `${multiSuffix}${supplierSuffix}`;
    return label.replace(/\s+/g, ' ').trim();
  };

  let label = compose(jobName, area);
  while (label.length > maxLabelLength && jobName.length > 1) {
    jobName = jobName.slice(0, -1).trimEnd();
    label = compose(jobName, area);
  }

  while (label.length > maxLabelLength && area.length > 1) {
    area = area.slice(0, -1).trimEnd();
    label = compose(jobName, area);
  }

  if (label.length > maxLabelLength && area) {
    area = '';
    label = compose(jobName, area);
  }

  if (label.length > maxLabelLength) {
    const reservedLength = `${prefix}${multiSuffix}${supplierSuffix}`.length + 1;
    const maxJobNameLength = Math.max(1, maxLabelLength - reservedLength);
    jobName = jobName.slice(0, maxJobNameLength).trimEnd() || 'J';
    label = compose(jobName, '');
  }

  return label || `${prefix}${multiSuffix}${supplierSuffix}`.trim();
}

function buildVendorOrderTextEmail(params: {
  vendorPoLabel: string;
  orderNumber: string;
  supplierName: string;
  sentBy: string;
  formattedDate: string;
  items: Array<{
    partNumber: string;
    description: string | null;
    uom?: string | null;
    quantityOrdered: number;
  }>;
}): string {
  const { vendorPoLabel, orderNumber, supplierName, sentBy, formattedDate, items } = params;
  return [
    'TOTAL FIRE PROTECTION PURCHASE REQUEST',
    `Job Info: ${vendorPoLabel}`,
    `Reference ID: ${orderNumber}`,
    `Supplier: ${supplierName}`,
    `Requested By: ${sentBy}`,
    `Date: ${formattedDate}`,
    `Total Items: ${items.length}`,
    '',
    'PartNumber | Description | UOM | Qty',
    ...items.map((item) =>
      `${item.partNumber} | ${(item.description || '-').replace(/\s+/g, ' ').trim()} | ${(item.uom || '-').replace(/\s+/g, ' ').trim()} | ${item.quantityOrdered}`
    ),
    '',
    'Please reply with availability and lead time.',
  ].join('\n');
}

/**
 * POST /api/admin/orders/send
 * Creates supplier-specific purchase order records and dispatches supplier-specific emails.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    const auth = await requirePermission(session, 'orders.generate_send');
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const { items } = body as { items: OrderItem[]; batchNote?: string };
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'No items provided' }, { status: 400 });
    }

    const sanitizedItems = items
      .map((item) => {
        const quantityOrdered = ensurePositiveQuantity(item.quantityOrdered);
        const supplierRaw = item.supplier ?? item.vendor ?? null;
        const supplierKey = normalizeSupplierKey(supplierRaw);
        return {
          jobNumber: String(item.jobNumber || '').trim(),
          listNumber: item.listNumber ? String(item.listNumber).trim() : null,
          jobName: String(item.jobName || '').trim(),
          partNumber: String(item.partNumber || '').trim(),
          description: item.description ? String(item.description) : null,
          uom: item.uom ? String(item.uom) : null,
          quantityOrdered,
          supplier: displaySupplierName(supplierKey),
          supplierKey,
        };
      })
      .filter((item) => item.jobNumber && item.partNumber && item.quantityOrdered > 0);

    if (sanitizedItems.length === 0) {
      return NextResponse.json({ error: 'No valid items provided' }, { status: 400 });
    }

    const jobItems = sanitizedItems.filter((item) => !isInventoryReplenishmentJobNumber(item.jobNumber));
    const inventoryItems = sanitizedItems.filter((item) => isInventoryReplenishmentJobNumber(item.jobNumber));

    const inventoryPartNumbers = Array.from(new Set(inventoryItems.map((item) => item.partNumber)));
    const inventoryParts = inventoryPartNumbers.length === 0 ? [] : await prisma.part.findMany({
      where: { pn: { in: inventoryPartNumbers } },
      select: { id: true, pn: true, orderMinimum: true, cost: true },
    });
    const inventoryPartByPn = new Map(inventoryParts.map((part) => [part.pn.toUpperCase(), part]));

    const pricingMap = await getPricingForParts(
      Array.from(new Set(sanitizedItems.map((item) => item.partNumber))),
    );

    const supplierKeys = [...new Set(sanitizedItems.map((item) => item.supplierKey))];
    const directoryByKey = await getVendorDirectoryByKeys(supplierKeys);

    const now = new Date();
    const sentBy = (session.user as any).name || (session.user as any).email || 'Unknown';
    const batchId = randomUUID();
    const purchasingEmail = (process.env.PURCHASING_FALLBACK_EMAIL || 'purchasing@totalfire.biz').trim().toLowerCase();

    // Sequence is per day across all supplier orders
    const dateStr = toDateKeyInAppTimeZone(now).replace(/-/g, '');
    const { start: todayStart, end: todayEnd } = getAppTimeZoneDayBounds(now);
    const todayOrderCount = await prisma.purchaseOrder.count({
      where: {
        sentAt: {
          gte: todayStart,
          lt: todayEnd,
        },
      },
    });

    const groupedBySupplier = new Map<string, typeof jobItems>();
    for (const item of jobItems) {
      if (!groupedBySupplier.has(item.supplierKey)) {
        groupedBySupplier.set(item.supplierKey, []);
      }
      groupedBySupplier.get(item.supplierKey)!.push(item);
    }

    const uniqueJobListPairs = Array.from(
      new Set(jobItems.map((item) => makeJobListKey(item.jobNumber, item.listNumber)))
    ).sort(compareJobListKey);
    const jobLabelRows = uniqueJobListPairs.length === 0 ? [] : await prisma.job.findMany({
      where: {
        OR: uniqueJobListPairs.map((pair) => {
          const [jobNumber, listNumber] = pair.split('::');
          return { jobNumber, listNumber };
        }),
      },
      select: {
        jobNumber: true,
        listNumber: true,
        jobName: true,
        area: true,
      },
    });
    const jobContextByKey = new Map<string, JobLabelContext>();
    for (const row of jobLabelRows) {
      const key = makeJobListKey(row.jobNumber, row.listNumber);
      if (!jobContextByKey.has(key)) {
        jobContextByKey.set(key, {
          jobNumber: normalizeLabelText(row.jobNumber),
          listNumber: normalizeLabelText(row.listNumber) || '1',
          jobName: normalizeLabelText(row.jobName) || 'Unknown Job',
          area: normalizeLabelText(row.area),
        });
      }
    }

    const supplierResults: SupplierResult[] = [];
    let orderOffset = 0;

    for (const [supplierKey, supplierItems] of groupedBySupplier.entries()) {
      orderOffset += 1;
      const sequenceNumber = String(todayOrderCount + orderOffset).padStart(4, '0');
      const orderNumber = `PO-${dateStr}-${sequenceNumber}`;
      const supplierName = displaySupplierName(supplierKey);
      const directoryEntry = directoryByKey.get(supplierKey);
      const supplierJobListKeys = Array.from(
        new Set(supplierItems.map((item) => makeJobListKey(item.jobNumber, item.listNumber)))
      ).sort(compareJobListKey);
      const primaryKey = supplierJobListKeys[0];
      const fallbackItem = supplierItems.find((item) => makeJobListKey(item.jobNumber, item.listNumber) === primaryKey) || supplierItems[0];
      const primaryContext = jobContextByKey.get(primaryKey) || {
        jobNumber: normalizeLabelText(fallbackItem.jobNumber),
        listNumber: normalizeLabelText(fallbackItem.listNumber) || '1',
        jobName: normalizeLabelText(fallbackItem.jobName) || 'Unknown Job',
        area: null,
      };
      const vendorPoLabel = buildVendorPoLabel(primaryContext, supplierJobListKeys.length > 1, supplierName);

      let recipientTo = parseEmailList(directoryEntry?.toEmails ?? []);
      const recipientCcFromDirectory = parseEmailList(directoryEntry?.ccEmails ?? []);
      const fallbackToPurchasing = recipientTo.length === 0;
      if (fallbackToPurchasing) {
        recipientTo = [purchasingEmail];
      }

      const recipientCc = [...new Set([...recipientCcFromDirectory, purchasingEmail])];
      const formattedDate = formatDateInAppTimeZone(now, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      });

      const htmlBody = buildPurchaseOrderEmailHtml({
        vendorPoLabel,
        orderNumber,
        supplierName,
        sentBy,
        formattedDate,
        items: supplierItems,
      });

      const textBody = buildVendorOrderTextEmail({
        vendorPoLabel,
        orderNumber,
        supplierName,
        sentBy,
        formattedDate,
        items: supplierItems,
      });

      let sendStatus: 'SENT' | 'FAILED' = 'SENT';
      let sendError: string | null = null;

      const jobPartPairs = Array.from(
        new Set(supplierItems.map((i) => `${i.jobNumber}\0${i.partNumber}`))
      ).map((s) => {
        const [jobNumber, partNumber] = s.split('\0');
        return { jobNumber, partNumber };
      });
      const jobRows = jobPartPairs.length === 0 ? [] : await prisma.job.findMany({
        where: {
          OR: jobPartPairs.map((p) => ({
            jobNumber: p.jobNumber,
            partNumber: p.partNumber,
          })),
        },
        select: {
          jobNumber: true,
          listNumber: true,
          partNumber: true,
          manualCost: true,
        },
      });
      const supplierItemsWithSnapshots = supplierItems.map((item) => {
        const requestList = normalizeListNumber(item.listNumber);
        const match =
          jobRows.find(
            (row) =>
              row.jobNumber === item.jobNumber &&
              row.partNumber === item.partNumber &&
              (requestList === '' || normalizeListNumber(row.listNumber) === requestList)
          ) ?? jobRows.find(
            (row) =>
              row.jobNumber === item.jobNumber && row.partNumber === item.partNumber
          );
        const manualCost =
          match?.manualCost === null || match?.manualCost === undefined
            ? null
            : Number(match.manualCost);
        const databaseCost = pricingMap.get(item.partNumber)?.cost ?? null;

        return {
          ...item,
          unitCostSnapshot: manualCost ?? databaseCost,
        };
      });

      const webhookResult = await sendPurchaseOrderWebhook({
        subject: `Total Fire Protection Purchase Request | ${vendorPoLabel} | ${supplierName}`,
        to: recipientTo.join(','),
        cc: recipientCc.join(','),
        supplier: supplierName,
        orderNumber,
        vendorPoLabel,
        sentBy,
        sentAt: now.toISOString(),
        totalItems: supplierItems.length,
        batchId,
        htmlBody,
        textBody,
        items: supplierItemsWithSnapshots,
      });

      if (!webhookResult.ok) {
        sendStatus = 'FAILED';
        sendError = webhookResult.error;
        supplierResults.push({
          supplier: supplierName,
          orderNumber,
          vendorPoLabel,
          recipientTo,
          recipientCc,
          itemCount: supplierItems.length,
          sendStatus,
          sendError,
          fallbackToPurchasing,
          emailDispatched: false,
        });
        continue;
      }

      const emailDispatched = webhookResult.mode === 'email_sent';

      const savedOrder = await prisma.purchaseOrder.create({
        data: {
          orderNumber,
          vendorPoLabel,
          items: supplierItemsWithSnapshots as unknown as Prisma.InputJsonValue,
          sentBy,
          sentAt: now,
          supplier: supplierName,
          orderKind: 'JOB',
          recipientTo: recipientTo as unknown as Prisma.InputJsonValue,
          recipientCc: recipientCc as unknown as Prisma.InputJsonValue,
          sendStatus,
          sendError,
          batchId,
        },
      });

      // Persist quantity ordered + supplier for each selected item.
      // Resolve Job rows by (jobNumber, partNumber) so we use the DB's listNumber in the update
      // and avoid listNumber format mismatch (e.g. "87" vs "0087") that would skip updating the row.
      await Promise.all(
        supplierItems.map((item) => {
          const requestList = normalizeListNumber(item.listNumber);
          const match =
            jobRows.find(
              (row) =>
                row.jobNumber === item.jobNumber &&
                row.partNumber === item.partNumber &&
                (requestList === '' || normalizeListNumber(row.listNumber) === requestList)
            ) ?? jobRows.find(
              (row) =>
                row.jobNumber === item.jobNumber && row.partNumber === item.partNumber
            );
          if (!match) return Promise.resolve();
          return prisma.job.updateMany({
            where: {
              jobNumber: match.jobNumber,
              listNumber: match.listNumber,
              partNumber: match.partNumber,
            },
            data: {
              quantityOrdered: item.quantityOrdered,
              type: supplierName,
              updatedAt: new Date(),
            },
          });
        })
      );

      supplierResults.push({
        supplier: supplierName,
        orderNumber: savedOrder.orderNumber,
        vendorPoLabel,
        recipientTo,
        recipientCc,
        itemCount: supplierItems.length,
        sendStatus,
        sendError,
        fallbackToPurchasing,
        emailDispatched,
      });
    }

    const inventoryGroupedBySupplier = new Map<string, typeof inventoryItems>();
    for (const item of inventoryItems) {
      if (!inventoryGroupedBySupplier.has(item.supplierKey)) {
        inventoryGroupedBySupplier.set(item.supplierKey, []);
      }
      inventoryGroupedBySupplier.get(item.supplierKey)!.push(item);
    }

    for (const [supplierKey, supplierItems] of inventoryGroupedBySupplier.entries()) {
      orderOffset += 1;
      const sequenceNumber = String(todayOrderCount + orderOffset).padStart(4, '0');
      const orderNumber = `PO-${dateStr}-${sequenceNumber}`;
      const supplierName = displaySupplierName(supplierKey);
      const directoryEntry = directoryByKey.get(supplierKey);
      const vendorPoLabel = `INVENTORY-STOCK ${INVENTORY_REORDER_JOB_NAME} - ${normalizeLabelText(supplierName)}`;

      let recipientTo = parseEmailList(directoryEntry?.toEmails ?? []);
      const recipientCcFromDirectory = parseEmailList(directoryEntry?.ccEmails ?? []);
      const fallbackToPurchasing = recipientTo.length === 0;
      if (fallbackToPurchasing) {
        recipientTo = [purchasingEmail];
      }

      const recipientCc = [...new Set([...recipientCcFromDirectory, purchasingEmail])];
      const formattedDate = formatDateInAppTimeZone(now, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      });

      const htmlBody = buildPurchaseOrderEmailHtml({
        vendorPoLabel,
        orderNumber,
        supplierName,
        sentBy,
        formattedDate,
        items: supplierItems.map((item) => ({
          ...item,
          jobName: INVENTORY_REORDER_JOB_NAME,
        })),
      });

      const textBody = buildVendorOrderTextEmail({
        vendorPoLabel,
        orderNumber,
        supplierName,
        sentBy,
        formattedDate,
        items: supplierItems,
      });

      let sendStatus: 'SENT' | 'FAILED' = 'SENT';
      let sendError: string | null = null;

      const supplierItemsWithSnapshots = supplierItems.map((item) => {
        const part = inventoryPartByPn.get(item.partNumber.toUpperCase());
        const databaseCost = pricingMap.get(item.partNumber)?.cost ?? null;
        return {
          ...item,
          listNumber: item.listNumber ?? INVENTORY_REORDER_LIST_NUMBER,
          jobName: INVENTORY_REORDER_JOB_NAME,
          partId: part?.id ?? null,
          orderKindLine: 'INVENTORY' as const,
          unitCostSnapshot: part ? Number(part.cost) : databaseCost,
        };
      });

      const webhookResult = await sendPurchaseOrderWebhook({
        subject: `Total Fire Protection Purchase Request | ${vendorPoLabel} | ${supplierName}`,
        to: recipientTo.join(','),
        cc: recipientCc.join(','),
        supplier: supplierName,
        orderNumber,
        vendorPoLabel,
        sentBy,
        sentAt: now.toISOString(),
        totalItems: supplierItems.length,
        batchId,
        htmlBody,
        textBody,
        items: supplierItemsWithSnapshots,
      });

      if (!webhookResult.ok) {
        sendStatus = 'FAILED';
        sendError = webhookResult.error;
        supplierResults.push({
          supplier: supplierName,
          orderNumber,
          vendorPoLabel,
          recipientTo,
          recipientCc,
          itemCount: supplierItems.length,
          sendStatus,
          sendError,
          fallbackToPurchasing,
          emailDispatched: false,
        });
        continue;
      }

      const emailDispatched = webhookResult.mode === 'email_sent';

      const savedOrder = await prisma.purchaseOrder.create({
        data: {
          orderNumber,
          vendorPoLabel,
          items: supplierItemsWithSnapshots as unknown as Prisma.InputJsonValue,
          sentBy,
          sentAt: now,
          supplier: supplierName,
          orderKind: 'INVENTORY',
          recipientTo: recipientTo as unknown as Prisma.InputJsonValue,
          recipientCc: recipientCc as unknown as Prisma.InputJsonValue,
          sendStatus,
          sendError,
          batchId,
        },
      });

      supplierResults.push({
        supplier: supplierName,
        orderNumber: savedOrder.orderNumber,
        vendorPoLabel,
        recipientTo,
        recipientCc,
        itemCount: supplierItems.length,
        sendStatus,
        sendError,
        fallbackToPurchasing,
        emailDispatched,
      });
    }

    const hasFailure = supplierResults.some((result) => result.sendStatus === 'FAILED');
    const emailDispatched = supplierResults.some((result) => result.emailDispatched);

    return NextResponse.json({
      success: !hasFailure,
      partialSuccess: hasFailure,
      emailDispatched,
      batchId,
      itemCount: sanitizedItems.length,
      supplierResults,
    });
  } catch (error) {
    console.error('Error in /api/admin/orders/send:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
