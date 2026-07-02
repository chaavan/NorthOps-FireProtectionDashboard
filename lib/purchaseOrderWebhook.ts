export type PurchaseOrderWebhookPayload = {
  subject: string;
  to: string;
  cc: string;
  supplier: string;
  orderNumber: string;
  vendorPoLabel: string;
  sentBy: string;
  sentAt: string;
  totalItems: number;
  batchId: string;
  htmlBody: string;
  textBody: string;
  items: unknown[];
};

export type PurchaseOrderWebhookResult =
  | { ok: true; mode: 'email_sent' }
  | { ok: true; mode: 'skipped' }
  | { ok: false; error: string };

export function getPurchaseOrderWebhookUrl(): string | null {
  const url = process.env.PURCHASE_ORDER_EMAIL_WEBHOOK_URL?.trim();
  return url || null;
}

/** When false, orders are recorded in-app only (no n8n / supplier email). */
export function isPurchaseOrderEmailEnabled(): boolean {
  const explicit = process.env.PURCHASE_ORDER_EMAIL_ENABLED?.trim().toLowerCase();
  if (explicit === 'false' || explicit === '0' || explicit === 'no') {
    return false;
  }
  if (explicit === 'true' || explicit === '1' || explicit === 'yes') {
    return Boolean(getPurchaseOrderWebhookUrl());
  }
  return Boolean(getPurchaseOrderWebhookUrl());
}

export function formatPurchaseOrderWebhookError(status: number, details: string): string {
  const trimmed = details.trim();
  if (!trimmed) {
    return `Purchase order webhook failed (${status}).`;
  }

  try {
    const parsed = JSON.parse(trimmed) as { message?: string; hint?: string };
    const message = String(parsed.message ?? '').trim();
    const hint = String(parsed.hint ?? '').trim();

    if (status === 404 && /not registered/i.test(message)) {
      return 'The purchase order email workflow is not active in n8n. Open the workflow, turn it on (production), then try again.';
    }

    if (message && hint) {
      return `${message} ${hint}`;
    }
    if (message) {
      return message;
    }
  } catch {
    // Fall through to raw details.
  }

  return `Purchase order webhook failed (${status}): ${trimmed}`;
}

export async function sendPurchaseOrderWebhook(
  payload: PurchaseOrderWebhookPayload,
): Promise<PurchaseOrderWebhookResult> {
  if (!isPurchaseOrderEmailEnabled()) {
    return { ok: true, mode: 'skipped' };
  }

  const webhookUrl = getPurchaseOrderWebhookUrl();
  if (!webhookUrl) {
    return { ok: true, mode: 'skipped' };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        // n8n workflows commonly expect `body` (see ENV_EXAMPLE.txt).
        body: payload.htmlBody,
      }),
    });

    if (!response.ok) {
      const details = await response.text();
      return {
        ok: false,
        error: formatPurchaseOrderWebhookError(response.status, details),
      };
    }

    return { ok: true, mode: 'email_sent' };
  } catch (error) {
    return {
      ok: false,
      error: (error as Error).message || 'Purchase order webhook request failed.',
    };
  }
}
