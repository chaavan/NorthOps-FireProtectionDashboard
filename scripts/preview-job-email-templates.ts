/**
 * Dev helper: write sample job notification HTML to /tmp for visual review.
 * Run: npx tsx scripts/preview-job-email-templates.ts
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { buildJobAccessAddedEmailHtml } from '../lib/email/templates/jobAccessAdded';
import { buildJobCreatedEmailHtml } from '../lib/email/templates/jobCreated';
import { buildJobNoteAddedEmailHtml } from '../lib/email/templates/jobNoteAdded';
import { buildJobUpdatedEmailHtml } from '../lib/email/templates/jobUpdated';
import { buildPurchaseOrderEmailHtml } from '../lib/email/templates/purchaseOrder';
import { buildPurchaseOrderCancellationEmailHtml } from '../lib/email/templates/purchaseOrderCancellation';

const outDir = join(process.cwd(), 'tmp', 'email-previews');
mkdirSync(outDir, { recursive: true });

const lineItems = Array.from({ length: 25 }, (_, i) => ({
  partNumber: `PART-${String(i + 1).padStart(5, '0')}`,
  description: `Sample part description ${i + 1}`,
  quantityNeeded: (i + 1) * 10,
  uom: i % 2 === 0 ? 'EA' : 'FT',
}));

writeFileSync(
  join(outDir, 'job-created.html'),
  buildJobCreatedEmailHtml({
    jobNumber: '12345',
    jobName: 'Acme Tower – Sprinkler Fit-out',
    listNumber: '1',
    deliveryDateDisplay: '3/15/2026, 12:00 AM CST',
    createdByDisplay: 'Jane Smith',
    createdAtDisplay: '3/10/2026, 2:30 PM CST',
    dashboardUrl: 'https://tfp.tools/job/12345?list=1',
    contractNumber: 'C-2026-001',
    area: 'North wing',
    locationShipTo: '123 Main St, Chicago IL',
    listedBy: 'jane@example.com',
    initialNote: {
      content: 'Please prioritize fab shop for week 1.\n\nContact GC before delivery.',
      createdBy: 'Jane Smith',
      createdAtDisplay: '3/10/2026, 2:31 PM CST',
      hasAttachments: true,
    },
    lineItems,
  }),
);

writeFileSync(
  join(outDir, 'job-access-added.html'),
  buildJobAccessAddedEmailHtml({
    recipientName: 'Bob Jones',
    jobNumber: '12345',
    jobName: 'Acme Tower – Sprinkler Fit-out',
    listNumber: '1',
    accessLevel: 'DESIGNER',
    grantedBy: 'Jane Smith',
    grantedByRole: 'PROJECT_MANAGER',
    grantedAtDisplay: '3/10/2026, 2:35 PM CST',
    dashboardUrl: 'https://tfp.tools/job/12345?list=1',
  }),
);

writeFileSync(
  join(outDir, 'job-note-added.html'),
  buildJobNoteAddedEmailHtml({
    jobNumber: '12345',
    jobName: 'Acme Tower – Sprinkler Fit-out',
    listNumber: '1',
    deliveryDateDisplay: '3/15/2026, 12:00 AM CST',
    createdByDisplay: 'Bob Jones',
    createdAtDisplay: '3/11/2026, 9:00 AM CST',
    noteContent: 'Updated valve schedule attached. Please review before ordering.',
    isReply: false,
    dashboardUrl: 'https://tfp.tools/job/12345?list=1&tab=notes&openNoteId=xyz',
  }),
);

writeFileSync(
  join(outDir, 'job-updated.html'),
  buildJobUpdatedEmailHtml({
    jobNumber: '12345',
    jobName: 'Acme Tower – Sprinkler Fit-out',
    listNumber: '1',
    deliveryDateDisplay: '3/20/2026, 12:00 AM CST',
    updatedByDisplay: 'Jane Smith',
    updatedAtDisplay: '3/12/2026, 4:15 PM CST',
    changes: [
      {
        label: 'Delivery date',
        before: '3/15/2026',
        after: '3/20/2026',
      },
    ],
    dashboardUrl: 'https://tfp.tools/job/12345?list=1',
  }),
);

writeFileSync(
  join(outDir, 'job-updated-with-note.html'),
  buildJobUpdatedEmailHtml({
    jobNumber: '12345',
    jobName: 'Acme Tower – Sprinkler Fit-out',
    listNumber: '1',
    deliveryDateDisplay: '3/20/2026, 12:00 AM CST',
    updatedByDisplay: 'Jane Smith',
    updatedAtDisplay: '3/12/2026, 4:15 PM CST',
    changes: [
      {
        label: 'Delivery date',
        before: '3/15/2026',
        after: '3/20/2026',
      },
    ],
    dashboardUrl:
      'https://tfp.tools/job/12345?list=1&tab=notes&openNoteId=xyz',
    ctaLabel: 'View note in dashboard',
    changeNote: {
      content: 'Customer requested a one-week push due to site access delays.',
      createdBy: 'Jane Smith',
      createdAtDisplay: '3/12/2026, 4:15 PM CST',
    },
  }),
);

writeFileSync(
  join(outDir, 'purchase-order.html'),
  buildPurchaseOrderEmailHtml({
    vendorPoLabel: '12345-1 Acme Tower – Sprinkler Fit-out - North wing - Ferguson',
    orderNumber: 'PO-2026-0042',
    supplierName: 'Ferguson',
    sentBy: 'Jane Smith',
    formattedDate: 'Wednesday, March 11, 2026 at 02:30 PM CDT',
    items: [
      {
        partNumber: 'FP-2-1/2-GV',
        description: '2-1/2 in. Grooved Gate Valve',
        uom: 'EA',
        quantityOrdered: 4,
      },
      {
        partNumber: 'BR-6-STD',
        description: '6 in. Standard Brace',
        uom: 'EA',
        quantityOrdered: 12,
      },
      {
        partNumber: 'PIPE-4-GS',
        description: '4 in. Galvanized Sprinkler Pipe',
        uom: 'FT',
        quantityOrdered: 120,
      },
    ],
  }),
);

writeFileSync(
  join(outDir, 'purchase-order-cancellation.html'),
  buildPurchaseOrderCancellationEmailHtml({
    vendorPoLabel: '12345-1 Acme Tower – Sprinkler Fit-out - North wing - Ferguson',
    orderNumber: 'PO-2026-0042',
    supplierName: 'Ferguson',
    sentBy: 'Jane Smith',
    formattedDate: 'Wednesday, March 11, 2026 at 02:30 PM CDT',
    cancelledItems: [
      {
        partNumber: 'FP-2-1/2-GV',
        description: '2-1/2 in. Grooved Gate Valve',
        uom: 'EA',
        quantityOrdered: 4,
      },
      {
        partNumber: 'BR-6-STD',
        description: '6 in. Standard Brace',
        uom: 'EA',
        quantityOrdered: 12,
      },
    ],
  }),
);

console.log(`Wrote email previews to ${outDir}`);
