'use client';

export interface NoteAttachmentUploadFailure {
  file: File;
  error: string;
}

export interface NoteAttachmentUploadResult {
  successful: number;
  failed: NoteAttachmentUploadFailure[];
}

interface UploadNoteAttachmentsOptions {
  jobNumber: string;
  listNumberContext?: string | null;
  noteId: string;
  files: File[];
  throwOnAnyFailure?: boolean;
  onError?: (message: string | null) => void;
}

export interface PreparedAttachmentUpload {
  blob: Blob;
  contentType: string;
  width: number | null;
  height: number | null;
  fileName: string | null;
}

function withListContext(path: string, listNumberContext?: string | null) {
  const normalized =
    typeof listNumberContext === 'string' &&
    listNumberContext.trim().length > 0 &&
    listNumberContext.trim() !== '__ALL__'
      ? listNumberContext.trim()
      : null;
  if (!normalized) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}listNumber=${encodeURIComponent(normalized)}`;
}

async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error(`Image load timeout after 10 seconds: ${file.name}`)),
        10000,
      );
      img.onload = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      img.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error(`Failed to load image: ${file.name}`));
      };
      img.src = objectUrl;
    });
    if (img.naturalWidth === 0 || img.naturalHeight === 0) {
      throw new Error(`Image has no readable dimensions: ${file.name}`);
    }
    return img;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function compressImageToWebP(
  file: File,
  opts: { maxDimension: number; quality: number },
): Promise<{ blob: Blob; width: number; height: number }> {
  const { maxDimension, quality } = opts;

  if (!file || file.size === 0) {
    throw new Error(`Invalid file: ${file?.name || 'unknown'}`);
  }
  if (file.size > 50 * 1024 * 1024) {
    throw new Error(`File too large: ${file.name}. Maximum size is 50MB.`);
  }

  const fileType = file.type || 'unknown';
  const fileName = file.name.toLowerCase();
  const isHeic =
    fileName.endsWith('.heic') ||
    fileName.endsWith('.heif') ||
    fileType.includes('heic') ||
    fileType.includes('heif');

  if (
    fileType &&
    !fileType.startsWith('image/') &&
    !isHeic &&
    fileType !== 'unknown' &&
    fileType !== 'application/octet-stream'
  ) {
    throw new Error(`Not an image file: ${file.name} (${fileType})`);
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    if (isHeic) {
      throw new Error(`HEIC format not supported: ${file.name}. Please convert it to JPEG and try again.`);
    }
    const img = await loadImageFromFile(file);
    try {
      bitmap = await createImageBitmap(img);
    } catch {
      const fallbackCanvas = document.createElement('canvas');
      fallbackCanvas.width = img.naturalWidth;
      fallbackCanvas.height = img.naturalHeight;
      const fallbackCtx = fallbackCanvas.getContext('2d');
      if (!fallbackCtx) {
        throw new Error('Could not create canvas context');
      }
      fallbackCtx.drawImage(img, 0, 0);
      bitmap = await createImageBitmap(fallbackCanvas);
    }
  }

  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const targetW = Math.max(1, Math.round(bitmap.width * scale));
  const targetH = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Could not create canvas context for compression');
  }
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();

  const blob =
    (await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b || null), 'image/webp', quality),
    )) ||
    (await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b || null), 'image/jpeg', quality),
    ));

  if (!blob) {
    throw new Error('Failed to compress image');
  }

  return { blob, width: targetW, height: targetH };
}

function formatUploadError(file: File, error: unknown, uploadPhase: string): string {
  const raw = error instanceof Error ? error.message : `Failed to upload ${file.name}`;
  const lowerName = file.name.toLowerCase();
  const isHeic =
    lowerName.endsWith('.heic') ||
    lowerName.endsWith('.heif') ||
    file.type?.includes('heic') ||
    file.type?.includes('heif');

  if (raw.includes('HEIC') || raw.includes('heic') || isHeic) {
    return `HEIC format is not supported for ${file.name}. Please convert it to JPEG and upload it from the Notes tab.`;
  }
  if (raw.includes('CORS')) return raw;
  if (
    raw.includes('network') ||
    raw.includes('Network') ||
    raw.includes('fetch') ||
    raw.includes('Failed to fetch')
  ) {
    if (uploadPhase === 'r2-put' || uploadPhase === 'server-upload') {
      return `Could not upload ${file.name} to file storage. Please retry from the Notes tab.`;
    }
    return `Network error while uploading ${file.name}. Retry from the Notes tab.`;
  }
  return raw;
}

export async function prepareAttachmentUpload(file: File): Promise<PreparedAttachmentUpload> {
  const isImage = file.type.startsWith('image/');
  let blob: Blob;
  let width: number | null;
  let height: number | null;
  const fileName = file.name?.trim() || null;

  if (isImage) {
    const compressed = await compressImageToWebP(file, {
      maxDimension: 1800,
      quality: 0.82,
    });
    blob = compressed.blob;
    width = compressed.width;
    height = compressed.height;
  } else {
    blob = file;
    width = null;
    height = null;
  }

  const lowerName = file.name.toLowerCase();
  const resolvedContentType = lowerName.endsWith('.pdf')
    ? 'application/pdf'
    : blob.type || file.type || 'application/octet-stream';

  return {
    blob,
    contentType: resolvedContentType,
    width,
    height,
    fileName,
  };
}

export function formatAttachmentUploadError(file: File, error: unknown, uploadPhase: string): string {
  return formatUploadError(file, error, uploadPhase);
}

export async function uploadNoteAttachments({
  jobNumber,
  listNumberContext,
  noteId,
  files,
  throwOnAnyFailure,
  onError,
}: UploadNoteAttachmentsOptions): Promise<NoteAttachmentUploadResult> {
  if (!files.length) {
    return { successful: 0, failed: [] };
  }

  const results: Array<{ file: File; success: boolean; error?: string }> = [];

  for (const file of files) {
    let uploadPhase: 'upload-url' | 'server-upload' | 'metadata' = 'upload-url';
    try {
      const prepared = await prepareAttachmentUpload(file);
      const effectiveContentType = prepared.contentType;
      const uploadUrlRes = await fetch(
        withListContext(
          `/api/jobs/${encodeURIComponent(jobNumber)}/notes/${encodeURIComponent(noteId)}/attachments/upload-url`,
          listNumberContext,
        ),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ contentType: effectiveContentType }),
        },
      );

      if (!uploadUrlRes.ok) {
        const errData = await uploadUrlRes.json().catch(() => null);
        throw new Error(errData?.error || `Failed to create upload URL for ${file.name}`);
      }

      const { r2Key } = await uploadUrlRes.json();
      uploadPhase = 'server-upload';

      const formData = new FormData();
      formData.append('file', prepared.blob, prepared.fileName || file.name);
      formData.append('r2Key', r2Key);
      formData.append('contentType', effectiveContentType);

      const uploadRes = await fetch(
        withListContext(
          `/api/jobs/${encodeURIComponent(jobNumber)}/notes/${encodeURIComponent(noteId)}/attachments/upload`,
          listNumberContext,
        ),
        {
          method: 'POST',
          credentials: 'include',
          body: formData,
        },
      );

      if (!uploadRes.ok) {
        const errData = await uploadRes.json().catch(() => null);
        throw new Error(errData?.error || `Upload to storage failed for ${file.name}`);
      }

      uploadPhase = 'metadata';
      const metaPayload: Record<string, unknown> = {
        r2Key,
        contentType: effectiveContentType,
        sizeBytes: prepared.blob.size,
        width: prepared.width ?? undefined,
        height: prepared.height ?? undefined,
      };
      if (prepared.fileName) metaPayload.fileName = prepared.fileName;

      const metaRes = await fetch(
        withListContext(
          `/api/jobs/${encodeURIComponent(jobNumber)}/notes/${encodeURIComponent(noteId)}/attachments`,
          listNumberContext,
        ),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(metaPayload),
        },
      );

      if (!metaRes.ok) {
        const errData = await metaRes.json().catch(() => null);
        throw new Error(errData?.error || `Failed to save metadata for ${file.name}`);
      }

      results.push({ file, success: true });
    } catch (err) {
      results.push({
        file,
        success: false,
        error: formatUploadError(file, err, uploadPhase),
      });
    }
  }

  const successful = results.filter((r) => r.success).length;
  const failed = results
    .filter((r) => !r.success)
    .map((r) => ({ file: r.file, error: r.error || `Failed: ${r.file.name}` }));

  if (failed.length > 0) {
    const errorText =
      successful > 0
        ? `Uploaded ${successful} of ${files.length} file(s).\n\nErrors:\n${failed.map((f) => f.error).join('\n')}`
        : `Failed to upload ${files.length} file(s).\n\nErrors:\n${failed.map((f) => f.error).join('\n')}`;
    onError?.(errorText);
    if (throwOnAnyFailure) {
      throw new Error(errorText);
    }
  } else if (successful > 0) {
    onError?.(null);
  }

  return { successful, failed };
}
