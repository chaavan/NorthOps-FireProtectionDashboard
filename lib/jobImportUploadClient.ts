/**
 * Client-only helpers for job PDF import / update uploads (matches Document AI limit in lib/jobImportDocumentAi.ts).
 * Your hosting provider may enforce a lower request body limit than 40 MB (check dashboard / docs if uploads fail for large files).
 */
export const JOB_IMPORT_MAX_PDF_BYTES = 40 * 1024 * 1024;

export const JOB_IMPORT_CLIENT_FETCH_TIMEOUT_MS = 15 * 60 * 1000;

export function isAcceptableJobImportPdf(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith('.pdf') ||
    file.type === 'application/pdf' ||
    file.type === 'application/x-pdf'
  );
}

export type ResolvePdfFromFileListResult =
  | { ok: true; file: File; info?: string }
  | { ok: false; error: string };

export function resolvePdfFromFileList(source: FileList | null | undefined): ResolvePdfFromFileListResult {
  const list = source && source.length ? Array.from(source) : [];
  if (list.length === 0) {
    return {
      ok: false,
      error: 'No file received. Try Browse or drag the file from File Explorer.',
    };
  }

  const pdfs = list.filter(isAcceptableJobImportPdf);
  if (pdfs.length === 0) {
    return { ok: false, error: 'Please upload a PDF file (.pdf).' };
  }

  const file = pdfs[0];
  const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
  if (file.size > JOB_IMPORT_MAX_PDF_BYTES) {
    return {
      ok: false,
      error: `This PDF is too large (${sizeMb} MB). Imports are limited to 40 MB for OCR processing.`,
    };
  }

  let info: string | undefined;
  if (list.length > 1) {
    info = 'Multiple files were dropped; using the first PDF only.';
  }

  return { ok: true, file, info };
}

export function isDragLeaveForCurrentZone(
  event: React.DragEvent,
  currentTarget: EventTarget & Node,
): boolean {
  const related = event.relatedTarget as Node | null;
  return !related || !currentTarget.contains(related);
}

export async function parseImportPostJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    if (!response.ok) {
      if (text.trim().startsWith('<')) {
        throw new Error(
          `Upload failed (${response.status}). The server returned an HTML error page—often a timeout or gateway limit on large PDFs.`,
        );
      }
      throw new Error(text.trim().slice(0, 400) || `Request failed (${response.status})`);
    }
    throw new Error('The server returned invalid JSON.');
  }

  const obj = (data || {}) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      typeof obj.error === 'string' && obj.error.trim()
        ? obj.error
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return obj;
}

export function createImportUploadAbortSignal(
  ms: number = JOB_IMPORT_CLIENT_FETCH_TIMEOUT_MS,
): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(id),
  };
}
