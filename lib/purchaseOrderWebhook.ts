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

export function getPurchaseOrderWebhookUrl(): string | null {
  const url = process.env.PURCHASE_ORDER_EMAIL_WEBHOOK_URL?.trim();
  return url || null;
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
): Promise<{ ok: true } | { ok: false; error: string }> {
  const webhookUrl = getPurchaseOrderWebhookUrl();
  if (!webhookUrl) {
    return {
      ok: false,
      error: 'PURCHASE_ORDER_EMAIL_WEBHOOK_URL is not set on the server.',
    };
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

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: (error as Error).message || 'Purchase order webhook request failed.',
    };
  }
}
