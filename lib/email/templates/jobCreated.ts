import { escapeHtml } from '@/lib/email/escapeHtml';
import {
  renderCard,
  renderDataTable,
  renderEmailDocument,
  renderEmailHeaderBand,
  renderHero,
  renderKeyValueGrid,
  renderKeyValueList,
  renderMutedText,
  renderNoteBody,
  renderPrimaryButton,
} from '@/lib/email/layout';

const LINE_ITEM_PREVIEW_LIMIT = 20;

export type JobCreatedEmailLineItem = {
  partNumber: string;
  description?: string | null;
  quantityNeeded: number;
  uom?: string | null;
};

export type JobCreatedEmailProps = {
  jobNumber: string;
  jobName: string;
  listNumber: string;
  deliveryDateDisplay: string;
  createdByDisplay: string;
  createdAtDisplay: string;
  dashboardUrl: string;
  contractNumber?: string | null;
  area?: string | null;
  locationShipTo?: string | null;
  listedBy?: string | null;
  initialNote?: {
    content: string;
    createdBy: string;
    createdAtDisplay: string;
    hasAttachments: boolean;
  } | null;
  lineItems: JobCreatedEmailLineItem[];
};

export function buildJobCreatedPreheader(props: JobCreatedEmailProps): string {
  const parts = [
    `Job ${props.jobNumber}`,
    props.jobName,
    `delivery ${props.deliveryDateDisplay}`,
  ];
  if (props.initialNote) parts.push('includes initial note');
  return parts.join(' · ');
}

export function buildJobCreatedEmailHtml(props: JobCreatedEmailProps): string {
  const {
    jobNumber,
    jobName,
    listNumber,
    deliveryDateDisplay,
    createdByDisplay,
    createdAtDisplay,
    dashboardUrl,
    lineItems,
    initialNote,
  } = props;

  const keyFacts = [
    { label: 'Delivery', value: deliveryDateDisplay },
    { label: 'List', value: listNumber },
    { label: 'Created by', value: createdByDisplay },
    { label: 'Created', value: createdAtDisplay },
  ];

  const detailRows: Array<{ label: string; value: string }> = [];
  if (props.contractNumber?.trim()) {
    detailRows.push({ label: 'Contract', value: props.contractNumber.trim() });
  }
  if (props.area?.trim()) {
    detailRows.push({ label: 'Area', value: props.area.trim() });
  }
  if (props.locationShipTo?.trim()) {
    detailRows.push({ label: 'Ship to', value: props.locationShipTo.trim() });
  }
  if (props.listedBy?.trim()) {
    detailRows.push({ label: 'Listed by', value: props.listedBy.trim() });
  }

  const previewItems = lineItems.slice(0, LINE_ITEM_PREVIEW_LIMIT);
  const truncated = lineItems.length > LINE_ITEM_PREVIEW_LIMIT;
  const materialsTable = renderDataTable({
    columns: [
      { header: 'Part', align: 'left' },
      { header: 'Description', align: 'left' },
      { header: 'Qty', align: 'right' },
      { header: 'UOM', align: 'left' },
    ],
    rows: previewItems.map((li) => [
      escapeHtml(li.partNumber),
      escapeHtml(li.description?.trim() || '—'),
      escapeHtml(String(li.quantityNeeded)),
      escapeHtml(li.uom?.trim() || '—'),
    ]),
    footerNote: truncated
      ? `Showing ${LINE_ITEM_PREVIEW_LIMIT} of ${lineItems.length} parts — open the job to see all.`
      : lineItems.length === 0
        ? 'No line items were included on this job.'
        : null,
  });

  const initialNoteSection = initialNote
    ? renderCard({
        title: 'Initial note',
        children: `${renderKeyValueList([
          { label: 'Added by', value: initialNote.createdBy },
          { label: 'Date', value: initialNote.createdAtDisplay },
        ])}
        ${renderNoteBody(initialNote.content)}
        ${
          initialNote.hasAttachments
            ? renderMutedText(
                'This note includes attachment(s). Open the job to view them.',
              )
            : ''
        }`,
      })
    : '';

  const moreDetailsSection =
    detailRows.length > 0
      ? renderCard({
          title: 'More details',
          children: renderKeyValueList(detailRows),
        })
      : '';

  const materialsSection = renderCard({
    title: `Materials (${lineItems.length})`,
    children: materialsTable,
  });

  return renderEmailDocument({
    preheader: buildJobCreatedPreheader(props),
    bodySections: [
      renderEmailHeaderBand('newJob'),
      renderHero({
        title: jobNumber,
        subtitle: jobName,
        intro: 'A new job has been created in the dashboard.',
      }),
      renderKeyValueGrid(keyFacts),
      moreDetailsSection,
      initialNoteSection,
      materialsSection,
      renderPrimaryButton(dashboardUrl, 'Open job in dashboard'),
    ],
  });
}
