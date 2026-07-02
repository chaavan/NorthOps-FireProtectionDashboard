/**
 * Notification service: job-created, access-added, and note-added n8n webhooks.
 */

import { prisma } from './prisma';
import { getJobAccessList } from './jobAccess';
import { formatDateInAppTimeZone } from './timezone';
import {
  DEFAULT_LIST_NUMBER,
  normalizeListContextForLookup,
} from './jobListContext';
import {
  buildJobAccessAddedEmailHtml,
} from '@/lib/email/templates/jobAccessAdded';
import {
  buildJobCreatedEmailHtml,
} from '@/lib/email/templates/jobCreated';
import {
  buildJobNoteAddedEmailHtml,
} from '@/lib/email/templates/jobNoteAdded';
import {
  buildJobUpdatedEmailHtml,
} from '@/lib/email/templates/jobUpdated';
import {
  buildJobNotesUrl,
  buildJobOverviewUrl,
} from '@/lib/email/jobDashboardUrls';
import { getPublicAppBaseUrl } from '@/lib/email/publicAppUrl';

// n8n webhook URL for job access-added notifications (Access tab)
const JOB_ACCESS_ADDED_WEBHOOK_URL = (() => {
  const url = process.env.JOB_ACCESS_ADDED_WEBHOOK_URL?.trim();
  if (!url) return undefined;
  if (/TODO|your-n8n|placeholder/i.test(url)) {
    console.warn(
      `[notifications] JOB_ACCESS_ADDED_WEBHOOK_URL looks like a placeholder (${url}). Access-added emails will not send until you set the production n8n webhook URL in .env`,
    );
    return undefined;
  }
  return url;
})();

function getWebhookUrl(): string | undefined {
  const url = process.env.JOB_NOTIFICATION_WEBHOOK_URL?.trim();
  if (!url) return undefined;
  if (/TODO|your-n8n|placeholder/i.test(url)) {
    console.warn(
      `[notifications] JOB_NOTIFICATION_WEBHOOK_URL looks like a placeholder (${url}). Job emails will not send until you set the production n8n webhook URL in .env`,
    );
    return undefined;
  }
  return url;
}

function getWebhookHost(): string {
  const url = getWebhookUrl();
  if (!url) return '(not configured)';
  try { return new URL(url).hostname; } catch { return '(invalid webhook url)'; }
}

interface JobAccessAddedPayload {
  subject: string;
  body: string;
  to: string;
  jobNumber: string;
  listNumber?: string | null;
  jobName: string | null;
  grantedBy: string;
  grantedByRole?: string | null;
  grantedAt: string;
  dashboardUrl: string;
}

export interface JobCreatedLineItem {
  partNumber: string;
  description?: string | null;
  quantityNeeded: number;
  uom?: string | null;
  type?: string | null;
}

export interface JobCreatedPayload {
  type: 'job_created';
  subject: string;
  htmlBody: string;
  to: string;
  jobNumber: string;
  jobName: string;
  listNumber?: string | null;
  deliveryDate: string;
  createdBy: string;
  createdAt: string;
  area?: string | null;
  locationShipTo?: string | null;
  listedBy?: string | null;
  contractNumber?: string | null;
  stocklistDeliveryShipDate?: string | null;
  initialNote?: {
    noteId?: string | null;
    noteContent: string;
    createdBy: string | null;
    createdByEmail: string | null;
    createdAt: string;
    hasAttachments: boolean;
  } | null;
  lineItemCount: number;
  lineItems: JobCreatedLineItem[];
  dashboardUrl: string;
}

export interface NoteAddedPayload {
  type: 'note_added';
  subject: string;
  htmlBody: string;
  to: string;
  jobNumber: string;
  jobName: string | null;
  listNumber: string;
  deliveryDate: string | null;
  noteId: string;
  noteContent: string;
  createdBy: string | null;
  createdByEmail: string | null;
  createdAt: string;
  isReply: boolean;
  dashboardUrl: string;
}

export type JobUpdateChange = {
  field: string;
  label: string;
  before: string;
  after: string;
};

export interface JobUpdatedPayload {
  type: 'job_updated';
  subject: string;
  htmlBody: string;
  to: string;
  jobNumber: string;
  jobName: string | null;
  listNumber: string;
  updatedBy: string | null;
  updatedByEmail: string | null;
  updatedAt: string;
  changes: JobUpdateChange[];
  dashboardUrl: string;
  changeNoteId?: string | null;
  changeNoteContent?: string | null;
}

export type JobUpdatedNotificationOptions = {
  changeNoteId?: string | null;
  changeNoteContent?: string | null;
  changeNoteCreatedBy?: string | null;
};

/** Send as `notificationSource` on PUT update-info to emit job-updated emails (overview Edit Job modal only). */
export const JOB_UPDATED_NOTIFICATION_SOURCE_OVERVIEW_EDIT =
  'overview_edit_job_modal' as const;

/**
 * Recipients are always scoped to a single list; default to list '1' when omitted
 * so we never notify other lists (no cross-list correlation).
 */
async function getJobAccessRecipients(
  jobNumber: string,
  listNumberContext?: string | null,
): Promise<
  Array<{
    id: string;
    name: string;
    email: string;
    phone?: string;
    role?: string;
  }>
> {
  const resolvedList =
    listNumberContext != null && String(listNumberContext).trim() !== ''
      ? normalizeListContextForLookup(listNumberContext)
      : DEFAULT_LIST_NUMBER;
  let accessList = await getJobAccessList(jobNumber, resolvedList);
  const primaryAccessCount = accessList.length;

  let usedFallbackFromDefaultList = false;
  if (accessList.length === 0 && resolvedList !== DEFAULT_LIST_NUMBER) {
    const fallbackList = await getJobAccessList(jobNumber, DEFAULT_LIST_NUMBER);
    if (fallbackList.length > 0) {
      accessList = fallbackList;
      usedFallbackFromDefaultList = true;
    }
  }
  const recipientEmails = Array.from(
    new Set(
      accessList
        .map((a) => a.userEmail?.trim().toLowerCase())
        .filter((e): e is string => !!e),
    ),
  );

  console.log(
    `[recipients] job=${jobNumber} list=${resolvedList} primaryAccessCount=${primaryAccessCount} ` +
      `usedFallback=${usedFallbackFromDefaultList} fallbackCount=${usedFallbackFromDefaultList ? accessList.length : 0} ` +
      `accessEmails=${recipientEmails.length} emails=[${recipientEmails.join(',')}]`,
  );

  if (recipientEmails.length === 0) {
    console.warn(
      `[recipients] EMPTY for job=${jobNumber} list=${resolvedList} - no notification will be sent`,
    );
    return [];
  }

  const users = await prisma.user.findMany({
    where: { email: { in: recipientEmails } },
    select: { id: true, email: true, name: true, role: true },
  });
  const usersByEmail = new Map(
    users.map((u) => [u.email.trim().toLowerCase(), u]),
  );

  return recipientEmails.map((email) => {
    const user = usersByEmail.get(email);
    return {
      id: user?.id || email,
      name: user?.name || user?.email || email,
      email: user?.email || email,
      phone: undefined,
      role: user?.role || undefined,
    };
  });
}

/**
 * Send a backorder summary email to purchasing
 */
export async function sendBackorderEmail(
  jobNumber: string,
  jobName: string | null,
  items: Array<{
    partNumber: string | null;
    description: string | null;
    remainingNeeded: number;
    supplier?: string | null;
  }>,
  createdBy: string
): Promise<boolean> {
  if (!items || items.length === 0) return false;

  // Graph/Outlook email sending for backorders has been removed.
  // Backorder notifications should be handled via the dedicated n8n
  // backorder webhook (see BACKORDER_UPLOAD_SETUP.md and related docs).
  console.log(
    `ℹ️ sendBackorderEmail called for job ${jobNumber}, but direct email sending is disabled. ` +
      'Use the N8N_BACKORDER_WEBHOOK_URL-based workflow instead.'
  );

  return false;
}

/**
 * Send an email notification to a user when they are granted access to a job
 * (Access tab – uses dedicated n8n webhook)
 */
export async function sendJobAccessAddedNotification(
  jobNumber: string,
  targetUserEmail: string,
  grantedBy: string,
  grantedByRole: string | null | undefined,
  grantedAt: Date,
  listNumberContext?: string | null,
): Promise<void> {
  if (!JOB_ACCESS_ADDED_WEBHOOK_URL) {
    console.warn(
      '⚠️ JOB_ACCESS_ADDED_WEBHOOK_URL not configured - skipping access-added email'
    );
    return;
  }

  try {
    const normalizedJobNumber = jobNumber.trim();
    const normalizedListNumber = normalizeListContextForLookup(listNumberContext);
    const normalizedEmail = targetUserEmail.trim().toLowerCase();

    const [job, user] = await Promise.all([
      prisma.job.findFirst({
        where: {
          jobNumber: normalizedJobNumber,
          listNumber: normalizedListNumber,
        },
        select: { jobName: true },
      }),
      prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { name: true, email: true },
      }),
    ]);

    if (!user) {
      console.warn(
        `⚠️ Target user ${normalizedEmail} not found while sending job access-added notification for job ${normalizedJobNumber}`
      );
      return;
    }

    const jobName = job?.jobName || null;
    const recipientName = user.name || user.email;
    const subject = `You have been added to job ${normalizedJobNumber} (List ${normalizedListNumber})${
      jobName ? ` – ${jobName}` : ''
    }`;

    const appBase = getPublicAppBaseUrl();
    const dashboardUrl = buildJobOverviewUrl(
      appBase,
      normalizedJobNumber,
      normalizedListNumber,
    );

    const grantedAtDisplay = formatDateInAppTimeZone(grantedAt, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });

    const htmlBody = buildJobAccessAddedEmailHtml({
      recipientName,
      jobNumber: normalizedJobNumber,
      jobName,
      listNumber: normalizedListNumber,
      grantedBy,
      grantedByRole: grantedByRole ?? null,
      grantedAtDisplay,
      dashboardUrl,
    });

    const payload: JobAccessAddedPayload = {
      subject,
      body: htmlBody,
      to: user.email,
      jobNumber: normalizedJobNumber,
      listNumber: normalizedListNumber,
      jobName,
      grantedBy,
      grantedByRole: grantedByRole ?? null,
      grantedAt: grantedAt.toISOString(),
      dashboardUrl,
    };

    const response = await fetch(JOB_ACCESS_ADDED_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error(
        `❌ Access-added webhook returned ${response.status}: ${
          text || response.statusText
        }`
      );
    } else {
      console.log(
        `✅ Sent access-added notification to ${user.email} for job ${normalizedJobNumber}`
      );
    }
  } catch (error) {
    console.error('❌ Error sending job access-added notification:', error);
  }
}

/**
 * Send job-created email to users explicitly listed in Job Access for this job (n8n webhook).
 */
export async function sendJobCreatedNotification(
  jobNumber: string,
  createdByEmail: string,
  createdByName: string | null | undefined,
  details: {
    jobName: string;
    listNumber?: string | null;
    deliveryDate: Date;
    area?: string | null;
    locationShipTo?: string | null;
    listedBy?: string | null;
    contractNumber?: string | null;
    stocklistDeliveryShipDate?: Date | null;
    initialNote?: {
      noteId?: string | null;
      content?: string | null;
      createdBy?: string | null;
      createdByEmail?: string | null;
      createdAt?: Date | null;
      hasAttachments?: boolean;
    } | null;
    lineItems: JobCreatedLineItem[];
  }
): Promise<void> {
  const normalizedJobNumber = jobNumber.trim();
  const normalizedListNumber = normalizeListContextForLookup(
    details.listNumber ?? null,
  );

  const jobCreatedWebhookUrl = getWebhookUrl();
  if (!jobCreatedWebhookUrl) {
    console.warn(
      `[job_created_notification] jobNumber=${normalizedJobNumber} JOB_NOTIFICATION_WEBHOOK_URL not configured - skipping job-created email`
    );
    return;
  }

  try {
    const webhookHost = getWebhookHost();

    const recipientContacts = await getJobAccessRecipients(
      normalizedJobNumber,
      normalizedListNumber,
    );
    const recipientEmails = recipientContacts.map((c) => c.email);
    if (recipientEmails.length === 0) {
      console.warn(
        `[job_created_notification] jobNumber=${normalizedJobNumber} webhookHost=${webhookHost} recipientCount=0 - no job-access recipients found, skipping job-created notification`
      );
      return;
    }

    console.log(
      `[job_created_notification] jobNumber=${normalizedJobNumber} webhookHost=${webhookHost} recipientCount=${recipientEmails.length} (job access users) sending to webhook`
    );

    const to = recipientEmails.join(', ');
    const subject = `New job created: ${normalizedJobNumber} – ${details.jobName}`;
    const appBase = getPublicAppBaseUrl();
    const dashboardUrl = buildJobOverviewUrl(
      appBase,
      normalizedJobNumber,
      normalizedListNumber,
    );

    const createdAtDisplay = formatDateInAppTimeZone(new Date(), {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
    const createdByDisplay = createdByName || createdByEmail;
    const deliveryDateDisplay = formatDateInAppTimeZone(details.deliveryDate, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      timeZoneName: 'short',
    });
    const initialNote = details.initialNote ?? null;
    const initialNoteContent = initialNote?.content?.trim() || '';
    const hasInitialNote =
      !!initialNote && (initialNoteContent.length > 0 || initialNote.hasAttachments === true);
    const initialNoteDisplayContent =
      initialNoteContent.length > 0 ? initialNoteContent : '(Attachment-only note)';
    const initialNoteCreatedAt = initialNote?.createdAt ?? new Date();
    const initialNoteCreatedAtDisplay = formatDateInAppTimeZone(initialNoteCreatedAt, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
    const initialNoteCreatedBy =
      initialNote?.createdBy || initialNote?.createdByEmail || createdByDisplay;

    const htmlBody = buildJobCreatedEmailHtml({
      jobNumber: normalizedJobNumber,
      jobName: details.jobName,
      listNumber: normalizedListNumber,
      deliveryDateDisplay,
      createdByDisplay,
      createdAtDisplay,
      dashboardUrl,
      contractNumber: details.contractNumber ?? null,
      area: details.area ?? null,
      locationShipTo: details.locationShipTo ?? null,
      listedBy: details.listedBy ?? null,
      initialNote: hasInitialNote
        ? {
            content: initialNoteDisplayContent,
            createdBy: initialNoteCreatedBy,
            createdAtDisplay: initialNoteCreatedAtDisplay,
            hasAttachments: initialNote?.hasAttachments === true,
          }
        : null,
      lineItems: details.lineItems,
    });

    const payload: JobCreatedPayload = {
      type: 'job_created',
      subject,
      htmlBody,
      to,
      jobNumber: normalizedJobNumber,
      jobName: details.jobName,
      listNumber: normalizedListNumber,
      deliveryDate: details.deliveryDate.toISOString(),
      createdBy: createdByEmail,
      createdAt: new Date().toISOString(),
      area: details.area ?? null,
      locationShipTo: details.locationShipTo ?? null,
      listedBy: details.listedBy ?? null,
      contractNumber: details.contractNumber ?? null,
      stocklistDeliveryShipDate: details.stocklistDeliveryShipDate
        ? details.stocklistDeliveryShipDate.toISOString()
        : null,
      initialNote: hasInitialNote
        ? {
            noteId: initialNote?.noteId ?? null,
            noteContent: initialNoteDisplayContent,
            createdBy: initialNote?.createdBy ?? null,
            createdByEmail: initialNote?.createdByEmail ?? null,
            createdAt: initialNoteCreatedAt.toISOString(),
            hasAttachments: initialNote?.hasAttachments === true,
          }
        : null,
      lineItemCount: details.lineItems.length,
      lineItems: details.lineItems,
      dashboardUrl,
    };

    const response = await fetch(jobCreatedWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const bodyPreview =
        typeof text === 'string' && text.length > 200
          ? text.slice(0, 200) + '...'
          : text;
      console.error(
        `[job_created_notification] jobNumber=${normalizedJobNumber} webhook returned status=${response.status} body=${bodyPreview || response.statusText}`
      );
    } else {
      console.log(
        `[job_created_notification] jobNumber=${normalizedJobNumber} sent successfully to ${recipientEmails.length} recipient(s)`
      );
    }
  } catch (error) {
    console.error(
      `[job_created_notification] jobNumber=${normalizedJobNumber} error:`,
      error
    );
  }
}

/**
 * Send job info updated email to job-access recipients + auto-included admins.
 * Callers should pass only the change rows to include (e.g. delivery date only from overview Edit Job).
 * Reuses JOB_NOTIFICATION_WEBHOOK_URL. Does not throw.
 */
export async function sendJobUpdatedNotification(
  jobNumber: string,
  listNumber: string,
  jobName: string | null,
  changes: JobUpdateChange[],
  updatedBy: string | null,
  updatedByEmail: string | null,
  options?: JobUpdatedNotificationOptions,
): Promise<void> {
  const normalizedJobNumber = jobNumber.trim();
  const normalizedListNumber = normalizeListContextForLookup(listNumber);

  if (changes.length === 0) {
    return;
  }

  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) {
    console.warn(
      `[job_updated_notification] jobNumber=${normalizedJobNumber} JOB_NOTIFICATION_WEBHOOK_URL not configured - skipping`,
    );
    return;
  }

  try {
    const webhookHost = getWebhookHost();

    const [recipientContacts, jobRow] = await Promise.all([
      getJobAccessRecipients(normalizedJobNumber, normalizedListNumber),
      prisma.job.findFirst({
        where: {
          jobNumber: normalizedJobNumber,
          listNumber: normalizedListNumber,
        },
        select: { jobName: true, deliveryDate: true },
      }),
    ]);

    const recipientEmails = recipientContacts.map((c) => c.email);
    if (recipientEmails.length === 0) {
      console.warn(
        `[job_updated_notification] jobNumber=${normalizedJobNumber} webhookHost=${webhookHost} recipientCount=0 - skipping`,
      );
      return;
    }

    const jobNameForSubject =
      (jobName && jobName.trim()) || jobRow?.jobName?.trim() || null;

    const deliveryDateDisplay =
      jobRow?.deliveryDate != null
        ? formatDateInAppTimeZone(jobRow.deliveryDate, {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            timeZoneName: 'short',
          })
        : null;

    const to = recipientEmails.join(', ');
    const plainSubject = `Job updated: ${normalizedJobNumber}${
      jobNameForSubject ? ` – ${jobNameForSubject}` : ''
    }`;

    const appBase = getPublicAppBaseUrl();
    const changeNoteId = options?.changeNoteId?.trim() || null;
    const changeNoteContent = options?.changeNoteContent?.trim() || '';
    const hasChangeNoteLink = !!changeNoteId;
    const hasChangeNoteBody = changeNoteContent.length > 0;

    const dashboardUrl = hasChangeNoteLink
      ? buildJobNotesUrl(appBase, normalizedJobNumber, normalizedListNumber, changeNoteId)
      : buildJobOverviewUrl(appBase, normalizedJobNumber, normalizedListNumber);

    const updatedAtDisplay = formatDateInAppTimeZone(new Date(), {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });

    const updatedByDisplay = updatedBy || updatedByEmail || 'Unknown user';
    const changeNoteCreatedBy =
      options?.changeNoteCreatedBy?.trim() || updatedByDisplay;

    const htmlBody = buildJobUpdatedEmailHtml({
      jobNumber: normalizedJobNumber,
      jobName: jobNameForSubject,
      listNumber: normalizedListNumber,
      deliveryDateDisplay,
      updatedByDisplay,
      updatedAtDisplay,
      changes,
      dashboardUrl,
      ctaLabel: hasChangeNoteLink ? 'View in Notes' : 'Open job in dashboard',
      changeNote: hasChangeNoteBody
        ? {
            content: changeNoteContent,
            createdBy: changeNoteCreatedBy,
            createdAtDisplay: updatedAtDisplay,
          }
        : null,
    });

    const payload: JobUpdatedPayload = {
      type: 'job_updated',
      subject: plainSubject,
      htmlBody,
      to,
      jobNumber: normalizedJobNumber,
      jobName: jobNameForSubject,
      listNumber: normalizedListNumber,
      updatedBy: updatedBy ?? null,
      updatedByEmail: updatedByEmail ?? null,
      updatedAt: new Date().toISOString(),
      changes,
      dashboardUrl,
      changeNoteId: hasChangeNoteLink ? changeNoteId : null,
      changeNoteContent: hasChangeNoteBody ? changeNoteContent : null,
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text().catch(() => '');
    const webhookOk = response.ok;
    if (!webhookOk) {
      const bodyPreview =
        responseText.length > 200
          ? responseText.slice(0, 200) + '...'
          : responseText;
      console.error(
        `[job_updated_notification] jobNumber=${normalizedJobNumber} webhook FAILED status=${response.status} body=${bodyPreview || response.statusText}`,
      );
    } else {
      console.log(
        `[job_updated_notification] jobNumber=${normalizedJobNumber} webhook OK status=${response.status} recipientCount=${recipientEmails.length} responsePreview=${responseText.slice(0, 100)}`,
      );
    }

    try {
      await prisma.$transaction(
        recipientEmails.map((email) =>
          prisma.jobNotification.create({
            data: {
              jobNumber: normalizedJobNumber,
              noteId: null,
              recipientEmail: email,
              type: 'job_update',
              status: webhookOk ? 'sent' : 'failed',
              error: webhookOk ? null : `Webhook returned ${response.status}`,
            },
          }),
        ),
      );
    } catch (logErr) {
      console.error('[job_updated_notification] failed to log notification rows:', logErr);
    }
  } catch (error) {
    console.error(`[job_updated_notification] jobNumber=${normalizedJobNumber} error:`, error);
  }
}

/**
 * Send note-added email to all job-access recipients + auto-included admins (n8n webhook).
 * Fire-and-forget: callers should NOT await this.
 */
export async function sendNoteAddedNotification(
  jobNumber: string,
  listNumber: string,
  noteId: string,
  noteContent: string,
  createdBy: string | null,
  createdByEmail: string | null,
  isReply: boolean,
): Promise<void> {
  const normalizedJobNumber = jobNumber.trim();
  const normalizedListNumber = normalizeListContextForLookup(listNumber);

  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) {
    console.warn(
      `[note_added_notification] jobNumber=${normalizedJobNumber} JOB_NOTIFICATION_WEBHOOK_URL not configured - skipping`
    );
    return;
  }

  try {
    const webhookHost = getWebhookHost();

    const [recipientContacts, job] = await Promise.all([
      getJobAccessRecipients(normalizedJobNumber, normalizedListNumber),
      prisma.job.findFirst({
        where: {
          jobNumber: normalizedJobNumber,
          listNumber: normalizedListNumber,
        },
        select: { jobName: true, deliveryDate: true },
      }),
    ]);

    const recipientEmails = recipientContacts.map((c) => c.email);
    if (recipientEmails.length === 0) {
      console.warn(
        `[note_added_notification] jobNumber=${normalizedJobNumber} webhookHost=${webhookHost} recipientCount=0 - skipping`
      );
      return;
    }

    console.log(
      `[note_added_notification] jobNumber=${normalizedJobNumber} webhookHost=${webhookHost} recipientCount=${recipientEmails.length} isReply=${isReply} sending to webhook`
    );

    const jobName = job?.jobName || null;
    const deliveryDateIso = job?.deliveryDate?.toISOString() ?? null;
    const deliveryDateDisplay =
      job?.deliveryDate != null
        ? formatDateInAppTimeZone(job.deliveryDate, {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            timeZoneName: 'short',
          })
        : null;
    const to = recipientEmails.join(', ');
    const actionLabel = isReply ? 'New reply' : 'New note';
    const subject = `${actionLabel} on job ${normalizedJobNumber}${
      jobName ? ` – ${jobName}` : ''
    }`;

    const dashboardUrl = buildJobNotesUrl(
      getPublicAppBaseUrl(),
      normalizedJobNumber,
      normalizedListNumber,
      noteId,
    );

    const createdAtDisplay = formatDateInAppTimeZone(new Date(), {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });

    const createdByDisplay = createdBy || createdByEmail || 'Unknown user';
    const displayContent =
      noteContent.trim().length > 0
        ? noteContent.trim()
        : '(Attachment-only note)';

    const htmlBody = buildJobNoteAddedEmailHtml({
      jobNumber: normalizedJobNumber,
      jobName,
      listNumber: normalizedListNumber,
      deliveryDateDisplay,
      createdByDisplay,
      createdAtDisplay,
      noteContent: displayContent,
      isReply,
      dashboardUrl,
    });

    const payload: NoteAddedPayload = {
      type: 'note_added',
      subject,
      htmlBody,
      to,
      jobNumber: normalizedJobNumber,
      jobName,
      listNumber: normalizedListNumber,
      deliveryDate: deliveryDateIso,
      noteId,
      noteContent: displayContent,
      createdBy: createdBy ?? null,
      createdByEmail: createdByEmail ?? null,
      createdAt: new Date().toISOString(),
      isReply,
      dashboardUrl,
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text().catch(() => '');
    const webhookOk = response.ok;
    if (!webhookOk) {
      const bodyPreview =
        responseText.length > 200
          ? responseText.slice(0, 200) + '...'
          : responseText;
      console.error(
        `[note_added_notification] jobNumber=${normalizedJobNumber} webhook FAILED status=${response.status} body=${bodyPreview || response.statusText}`
      );
    } else {
      console.log(
        `[note_added_notification] jobNumber=${normalizedJobNumber} webhook OK status=${response.status} recipientCount=${recipientEmails.length} responsePreview=${responseText.slice(0, 100)}`
      );
    }

    try {
      await prisma.$transaction(
        recipientEmails.map((email) =>
          prisma.jobNotification.create({
            data: {
              jobNumber: normalizedJobNumber,
              noteId,
              recipientEmail: email,
              type: 'note',
              status: webhookOk ? 'sent' : 'failed',
              error: webhookOk
                ? null
                : `Webhook returned ${response.status}`,
            },
          }),
        ),
      );
    } catch (logErr) {
      console.error(
        '[note_added_notification] failed to log notification rows:',
        logErr,
      );
    }
  } catch (error) {
    console.error(
      `[note_added_notification] jobNumber=${normalizedJobNumber} error:`,
      error,
    );
  }
}
