import { escapeHtml } from './escapeHtml';

export const EMAIL_BRAND = 'Total Fire Protection';

export type EmailBadgeVariant =
  | 'newJob'
  | 'accessGranted'
  | 'noteAdded'
  | 'jobUpdated'
  | 'purchaseOrder'
  | 'orderCancelled';

const BADGE_STYLES: Record<
  EmailBadgeVariant,
  { bg: string; color: string; label: string }
> = {
  newJob: { bg: '#dbeafe', color: '#1d4ed8', label: 'New job' },
  accessGranted: { bg: '#dcfce7', color: '#15803d', label: 'Access granted' },
  noteAdded: { bg: '#fef3c7', color: '#b45309', label: 'Note added' },
  jobUpdated: { bg: '#ede9fe', color: '#6d28d9', label: 'Job updated' },
  purchaseOrder: { bg: '#f3e8ff', color: '#7c3aed', label: 'Purchase order' },
  orderCancelled: { bg: '#fee2e2', color: '#b91c1c', label: 'Order cancelled' },
};

export type KeyValueRow = { label: string; value: string };

export type DataTableColumn = {
  header: string;
  align?: 'left' | 'right' | 'center';
};

export function renderEmailDocument(options: {
  preheader: string;
  bodySections: string[];
}): string {
  const { preheader, bodySections } = options;
  const sections = bodySections.filter(Boolean).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${escapeHtml(EMAIL_BRAND)}</title>
</head>
<body style="margin:0;padding:0;background-color:#eef2f7;font-family:Arial,Helvetica,sans-serif;color:#111827;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(preheader)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#eef2f7;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
          ${sections}
          ${renderEmailFooter()}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

export function renderEmailHeaderBand(variant: EmailBadgeVariant): string {
  const badge = BADGE_STYLES[variant];
  return `<tr>
  <td style="padding:20px 24px 16px 24px;border-bottom:1px solid #e5e7eb;background-color:#ffffff;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td style="font-size:13px;font-weight:700;color:#374151;letter-spacing:0.02em;">${escapeHtml(EMAIL_BRAND)}</td>
        <td align="right">
          <span style="display:inline-block;padding:4px 10px;border-radius:999px;background-color:${badge.bg};color:${badge.color};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(badge.label)}</span>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

export function renderHero(options: {
  title: string;
  subtitle?: string | null;
  intro?: string | null;
}): string {
  const subtitleBlock = options.subtitle
    ? `<p style="margin:8px 0 0 0;font-size:16px;line-height:1.4;color:#4b5563;">${escapeHtml(options.subtitle)}</p>`
    : '';
  const introBlock = options.intro
    ? `<p style="margin:16px 0 0 0;font-size:14px;line-height:1.6;color:#374151;">${escapeHtml(options.intro)}</p>`
    : '';

  return `<tr>
  <td style="padding:20px 24px 8px 24px;">
    <h1 style="margin:0;font-size:24px;line-height:1.25;font-weight:700;color:#111827;">${escapeHtml(options.title)}</h1>
    ${subtitleBlock}
    ${introBlock}
  </td>
</tr>`;
}

export function renderPrimaryButton(href: string, label: string): string {
  return `<tr>
  <td style="padding:8px 24px 20px 24px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center" bgcolor="#2563eb" style="border-radius:6px;background-color:#2563eb;">
          <a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

export function renderKeyValueGrid(rows: KeyValueRow[]): string {
  if (rows.length === 0) return '';
  const cells = rows
    .map(
      (row) => `<td width="${Math.floor(100 / Math.min(rows.length, 3))}%" valign="top" style="padding:0 8px 0 0;">
        <p style="margin:0 0 4px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;">${escapeHtml(row.label)}</p>
        <p style="margin:0;font-size:14px;line-height:1.4;font-weight:600;color:#111827;">${escapeHtml(row.value)}</p>
      </td>`,
    )
    .join('');

  return `<tr>
  <td style="padding:0 24px 16px 24px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;">
      <tr>
        <td style="padding:14px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>${cells}</tr>
          </table>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

export function renderCard(options: {
  title: string;
  children: string;
}): string {
  return `<tr>
  <td style="padding:0 24px 16px 24px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;">
      <tr>
        <td style="padding:14px 16px;">
          <p style="margin:0 0 12px 0;font-size:13px;font-weight:700;color:#1f2937;text-transform:uppercase;letter-spacing:0.03em;">${escapeHtml(options.title)}</p>
          ${options.children}
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

export function renderKeyValueList(rows: KeyValueRow[]): string {
  if (rows.length === 0) return '';
  const listRows = rows
    .map(
      (row) => `<tr>
        <td style="padding:6px 0;font-size:12px;font-weight:700;color:#6b7280;width:120px;vertical-align:top;">${escapeHtml(row.label)}</td>
        <td style="padding:6px 0 6px 8px;font-size:14px;line-height:1.5;color:#111827;vertical-align:top;">${escapeHtml(row.value)}</td>
      </tr>`,
    )
    .join('');

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${listRows}</table>`;
}

export function renderNoteBody(content: string): string {
  return `<div style="margin:0;padding:14px 16px;background-color:#ffffff;border:1px solid #dbeafe;border-left:4px solid #2563eb;border-radius:6px;font-size:14px;line-height:1.65;color:#1f2937;white-space:pre-wrap;word-wrap:break-word;">${escapeHtml(content)}</div>`;
}

export function renderMutedText(text: string): string {
  return `<p style="margin:10px 0 0 0;font-size:13px;line-height:1.5;color:#6b7280;">${escapeHtml(text)}</p>`;
}

/** Highlighted call-to-action or instruction block (e.g. supplier reply request). */
export function renderActionCallout(lines: string[]): string {
  const paragraphs = lines
    .filter((line) => line.trim().length > 0)
    .map(
      (line, idx, arr) =>
        `<p style="margin:${idx === arr.length - 1 ? '0' : '0 0 10px 0'};font-size:14px;line-height:1.65;color:#1e3a5f;">${escapeHtml(line)}</p>`,
    )
    .join('');

  return `<div style="margin:0;padding:14px 16px;background-color:#eff6ff;border:1px solid #bfdbfe;border-left:4px solid #2563eb;border-radius:6px;">${paragraphs}</div>`;
}

export function renderAccessLevelPill(label: string): string {
  return `<span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:#dbeafe;color:#1e40af;font-size:13px;font-weight:700;">${escapeHtml(label)}</span>`;
}

export function renderDataTable(options: {
  columns: DataTableColumn[];
  rows: string[][];
  footerNote?: string | null;
}): string {
  const headerCells = options.columns
    .map(
      (col) =>
        `<th align="${col.align ?? 'left'}" style="padding:10px 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#374151;background-color:#f3f4f6;border-bottom:1px solid #e5e7eb;">${escapeHtml(col.header)}</th>`,
    )
    .join('');

  const bodyRows = options.rows
    .map((cells, idx) => {
      const bg = idx % 2 === 0 ? '#ffffff' : '#f9fafb';
      const tds = cells
        .map((cell, cellIdx) => {
          const align = options.columns[cellIdx]?.align ?? 'left';
          return `<td align="${align}" style="padding:8px;font-size:13px;line-height:1.4;color:#111827;border-bottom:1px solid #f3f4f6;background-color:${bg};">${cell}</td>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');

  const footer = options.footerNote
    ? `<p style="margin:10px 0 0 0;font-size:12px;line-height:1.5;color:#6b7280;">${escapeHtml(options.footerNote)}</p>`
    : '';

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>${footer}`;
}

export function renderChangesTable(
  changes: Array<{ label: string; before: string; after: string }>,
): string {
  const rows = changes
    .map(
      (c) => `<tr>
        <td style="padding:10px 8px;font-size:13px;font-weight:700;color:#374151;border:1px solid #e5e7eb;background-color:#f9fafb;vertical-align:top;">${escapeHtml(c.label)}</td>
        <td style="padding:10px 8px;font-size:13px;line-height:1.5;color:#6b7280;border:1px solid #e5e7eb;white-space:pre-wrap;word-break:break-word;vertical-align:top;">${escapeHtml(c.before)}</td>
        <td style="padding:10px 8px;font-size:13px;line-height:1.5;color:#111827;border:1px solid #e5e7eb;background-color:#ecfdf5;white-space:pre-wrap;word-break:break-word;vertical-align:top;">${escapeHtml(c.after)}</td>
      </tr>`,
    )
    .join('');

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
    <thead>
      <tr>
        <th align="left" style="padding:10px 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#374151;background-color:#f3f4f6;border:1px solid #e5e7eb;">Field</th>
        <th align="left" style="padding:10px 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#374151;background-color:#f3f4f6;border:1px solid #e5e7eb;">Before</th>
        <th align="left" style="padding:10px 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#374151;background-color:#f3f4f6;border:1px solid #e5e7eb;">After</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderEmailFooter(): string {
  return `<tr>
  <td style="padding:16px 24px 20px 24px;border-top:1px solid #e5e7eb;background-color:#f9fafb;">
    <p style="margin:0;font-size:11px;line-height:1.5;color:#9ca3af;text-align:center;">This message was generated automatically by the ${escapeHtml(EMAIL_BRAND)} dashboard.</p>
  </td>
</tr>`;
}
