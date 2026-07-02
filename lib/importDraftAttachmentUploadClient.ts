'use client';

import {
  formatAttachmentUploadError,
  prepareAttachmentUpload,
} from '@/lib/noteAttachmentUploadClient';
import type { JobImportDraftAttachment } from '@/lib/jobImportTypes';

export interface ImportDraftAttachmentUploadFailure {
  file: File;
  error: string;
}

export interface ImportDraftAttachmentUploadResult {
  successful: JobImportDraftAttachment[];
  failed: ImportDraftAttachmentUploadFailure[];
}

export async function uploadImportDraftAttachments(params: {
  importId: string;
  files: File[];
  onError?: (message: string | null) => void;
}): Promise<ImportDraftAttachmentUploadResult> {
  const { importId, files, onError } = params;
  const successful: JobImportDraftAttachment[] = [];
  const failed: ImportDraftAttachmentUploadFailure[] = [];

  for (const file of files) {
    let uploadPhase: 'upload-url' | 'server-upload' | 'metadata' = 'upload-url';
    try {
      const prepared = await prepareAttachmentUpload(file);
      const uploadUrlRes = await fetch(
        `/api/job-imports/${encodeURIComponent(importId)}/draft-attachments/upload-url`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ contentType: prepared.contentType }),
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
      formData.append('contentType', prepared.contentType);

      const uploadRes = await fetch(
        `/api/job-imports/${encodeURIComponent(importId)}/draft-attachments/upload`,
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
      const metaRes = await fetch(
        `/api/job-imports/${encodeURIComponent(importId)}/draft-attachments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            r2Key,
            contentType: prepared.contentType,
            sizeBytes: prepared.blob.size,
            width: prepared.width ?? undefined,
            height: prepared.height ?? undefined,
            fileName: prepared.fileName ?? undefined,
          }),
        },
      );
      if (!metaRes.ok) {
        const errData = await metaRes.json().catch(() => null);
        throw new Error(errData?.error || `Failed to save metadata for ${file.name}`);
      }

      const data = await metaRes.json();
      successful.push(data.attachment);
    } catch (error) {
      failed.push({
        file,
        error: formatAttachmentUploadError(file, error, uploadPhase),
      });
    }
  }

  if (failed.length > 0) {
    const errorText =
      successful.length > 0
        ? `Uploaded ${successful.length} of ${files.length} file(s).\n\nErrors:\n${failed.map((f) => f.error).join('\n')}`
        : `Failed to upload ${files.length} file(s).\n\nErrors:\n${failed.map((f) => f.error).join('\n')}`;
    onError?.(errorText);
  } else if (successful.length > 0) {
    onError?.(null);
  }

  return { successful, failed };
}
