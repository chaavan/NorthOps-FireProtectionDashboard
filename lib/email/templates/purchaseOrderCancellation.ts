import { escapeHtml } from '@/lib/email/escapeHtml';
import {
  renderActionCallout,
  renderCard,
  renderDataTable,
  renderEmailDocument,
  renderEmailHeaderBand,
  renderHero,
  renderKeyValueGrid,
  renderKeyValueList,
} from '@/lib/email/layout';

export type PurchaseOrderCancellationLineItem = {
  partNumber: string;
  description?: string | null;
  uom?: string | null;
  quantityOrdered: number;
};

export type PurchaseOrderCancellationEmailProps = {
  vendorPoLabel: string;
  orderNumber: string;
  supplierName: string;
  sentBy: string;
  formattedDate: string;
  cancelledItems: PurchaseOrderCancellationLineItem[];
};

export function buildPurchaseOrderCancellationPreheader(
  props: PurchaseOrderCancellationEmailProps,
): string {
  const totalQty = props.cancelledItems.reduce(
    (sum, item) => sum + item.quantityOrdered,
    0,
  );
  return [
    'Order cancelled',
    props.supplierName,
    props.vendorPoLabel,
    `Ref ${props.orderNumber}`,
    `${props.cancelledItems.length} line${props.cancelledItems.length === 1 ? '' : 's'}`,
    `${totalQty} pcs`,
  ].join(' · ');
}

export function buildPurchaseOrderCancellationEmailHtml(
  props: PurchaseOrderCancellationEmailProps,
): string {
  const {
    vendorPoLabel,
    orderNumber,
    supplierName,
    sentBy,
    formattedDate,
    cancelledItems,
  } = props;

  const totalQty = cancelledItems.reduce((sum, item) => sum + item.quantityOrdered, 0);

  const keyFacts = [
    { label: 'Reference', value: orderNumber },
    { label: 'Supplier', value: supplierName },
    { label: 'Requested by', value: sentBy },
    { label: 'Date', value: formattedDate },
  ];

  const itemsTable = renderDataTable({
    columns: [
      { header: 'Part', align: 'left' },
      { header: 'Description', align: 'left' },
      { header: 'UOM', align: 'left' },
      { header: 'Qty', align: 'right' },
    ],
    rows: cancelledItems.map((item) => [
      `<span style="font-weight:700;color:#111827;">${escapeHtml(item.partNumber)}</span>`,
      escapeHtml(item.description?.trim() || '—'),
      escapeHtml(item.uom?.trim() || '—'),
      `<span style="font-weight:700;color:#111827;">${escapeHtml(String(item.quantityOrdered))}</span>`,
    ]),
    footerNote: `${cancelledItems.length} cancelled line${cancelledItems.length === 1 ? '' : 's'} · ${totalQty} total quantity`,
  });

  const jobDetailsSection = renderCard({
    title: 'Job',
    children: renderKeyValueList([{ label: 'Job info', value: vendorPoLabel }]),
  });

  const itemsSection = renderCard({
    title: `Cancelled items (${cancelledItems.length})`,
    children: itemsTable,
  });

  return renderEmailDocument({
    preheader: buildPurchaseOrderCancellationPreheader(props),
    bodySections: [
      renderEmailHeaderBand('orderCancelled'),
      renderHero({
        title: 'Order cancellation',
        subtitle: supplierName,
        intro: 'Please confirm cancellation receipt for the line items below.',
      }),
      renderKeyValueGrid(keyFacts),
      jobDetailsSection,
      itemsSection,
      renderCard({
        title: 'Next step',
        children: renderActionCallout([
          'Please confirm that you have received this cancellation notice.',
          'If any of these items were already shipped, reply with tracking or shipment details.',
        ]),
      }),
    ],
  });
}

export function buildPurchaseOrderCancellationTextEmail(
  props: PurchaseOrderCancellationEmailProps,
): string {
  const {
    vendorPoLabel,
    orderNumber,
    supplierName,
    sentBy,
    formattedDate,
    cancelledItems,
  } = props;

  return [
    'TOTAL FIRE PROTECTION — ORDER CANCELLATION',
    '',
    `Job info: ${vendorPoLabel}`,
    `Reference: ${orderNumber}`,
    `Supplier: ${supplierName}`,
    `Requested by: ${sentBy}`,
    `Date: ${formattedDate}`,
    '',
    'Cancelled items',
    'Part | Description | UOM | Qty',
    ...cancelledItems.map(
      (item) =>
        `${item.partNumber} | ${(item.description || '—').replace(/\s+/g, ' ').trim()} | ${item.uom?.trim() || '—'} | ${item.quantityOrdered}`,
    ),
    '',
    'Please confirm that you have received this cancellation notice.',
  ].join('\n');
}
