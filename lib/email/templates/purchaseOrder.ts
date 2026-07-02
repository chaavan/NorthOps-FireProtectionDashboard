import { escapeHtml } from '@/lib/email/escapeHtml';
import {
  renderCard,
  renderDataTable,
  renderEmailDocument,
  renderEmailHeaderBand,
  renderHero,
  renderKeyValueGrid,
  renderKeyValueList,
} from '@/lib/email/layout';

export type PurchaseOrderEmailLineItem = {
  partNumber: string;
  description?: string | null;
  uom?: string | null;
  quantityOrdered: number;
};

export type PurchaseOrderEmailProps = {
  vendorPoLabel: string;
  orderNumber: string;
  supplierName: string;
  sentBy: string;
  formattedDate: string;
  items: PurchaseOrderEmailLineItem[];
};

export function buildPurchaseOrderPreheader(props: PurchaseOrderEmailProps): string {
  const totalQty = props.items.reduce(
    (sum, item) => sum + item.quantityOrdered,
    0,
  );
  return [
    props.supplierName,
    props.vendorPoLabel,
    `Ref ${props.orderNumber}`,
    `${props.items.length} line${props.items.length === 1 ? '' : 's'}`,
    `${totalQty} pcs`,
  ].join(' · ');
}

export function buildPurchaseOrderEmailHtml(props: PurchaseOrderEmailProps): string {
  const {
    vendorPoLabel,
    orderNumber,
    supplierName,
    sentBy,
    formattedDate,
    items,
  } = props;

  const totalQty = items.reduce((sum, item) => sum + item.quantityOrdered, 0);

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
    rows: items.map((item) => [
      `<span style="font-weight:700;color:#111827;">${escapeHtml(item.partNumber)}</span>`,
      escapeHtml(item.description?.trim() || '—'),
      escapeHtml(item.uom?.trim() || '—'),
      `<span style="font-weight:700;color:#111827;">${escapeHtml(String(item.quantityOrdered))}</span>`,
    ]),
    footerNote: `${items.length} line item${items.length === 1 ? '' : 's'} · ${totalQty} total quantity`,
  });

  const jobDetailsSection = renderCard({
    title: 'Job',
    children: renderKeyValueList([{ label: 'Job info', value: vendorPoLabel }]),
  });

  const itemsSection = renderCard({
    title: `Items to order (${items.length})`,
    children: itemsTable,
  });

  return renderEmailDocument({
    preheader: buildPurchaseOrderPreheader(props),
    bodySections: [
      renderEmailHeaderBand('purchaseOrder'),
      renderHero({
        title: 'Purchase request',
        subtitle: supplierName,
        intro: 'Please review the line items below.',
      }),
      renderKeyValueGrid(keyFacts),
      jobDetailsSection,
      itemsSection,
    ],
  });
}
