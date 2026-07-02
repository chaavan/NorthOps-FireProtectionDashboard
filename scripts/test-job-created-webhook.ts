/**
 * POST a sample job_created payload to JOB_NOTIFICATION_WEBHOOK_URL.
 * Run: npx tsx scripts/test-job-created-webhook.ts
 */
import { config } from 'dotenv';
import { buildJobCreatedEmailHtml } from '../lib/email/templates/jobCreated';

config({ path: '.env' });

const webhookUrl = process.env.JOB_NOTIFICATION_WEBHOOK_URL?.trim();
if (!webhookUrl) {
  console.error('JOB_NOTIFICATION_WEBHOOK_URL is not set in .env');
  process.exit(1);
}

const htmlBody = buildJobCreatedEmailHtml({
  jobNumber: 'TEST-WEBHOOK',
  jobName: 'Webhook smoke test',
  listNumber: '1',
  deliveryDateDisplay: '5/26/2026',
  createdByDisplay: 'Test User',
  createdAtDisplay: '5/26/2026, 8:49 PM',
  dashboardUrl: 'https://tfp.tools/job/TEST-WEBHOOK?list=1',
  lineItems: [{ partNumber: 'P-001', description: 'Test part', quantityNeeded: 1, uom: 'EA' }],
  initialNote: {
    content: 'Test initial note body',
    createdBy: 'Test User',
    createdAtDisplay: '5/26/2026, 8:49 PM',
    hasAttachments: false,
  },
});

const payload = {
  type: 'job_created' as const,
  subject: 'New job created: TEST-WEBHOOK – Webhook smoke test',
  htmlBody,
  to: process.env.ADMIN_EMAIL || 'test@example.com',
  jobNumber: 'TEST-WEBHOOK',
  jobName: 'Webhook smoke test',
  listNumber: '1',
  deliveryDate: new Date().toISOString(),
  createdBy: 'test@example.com',
  createdAt: new Date().toISOString(),
  lineItemCount: 1,
  lineItems: [{ partNumber: 'P-001', description: 'Test part', quantityNeeded: 1, uom: 'EA' }],
  dashboardUrl: 'https://tfp.tools/job/TEST-WEBHOOK?list=1',
  initialNote: {
    noteContent: 'Test initial note body',
    createdBy: 'Test User',
    createdByEmail: 'test@example.com',
    createdAt: new Date().toISOString(),
    hasAttachments: false,
  },
};

async function main() {
  console.log('POST', webhookUrl);
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  console.log('status', res.status, res.statusText);
  console.log('body', text.slice(0, 500));
  process.exit(res.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
