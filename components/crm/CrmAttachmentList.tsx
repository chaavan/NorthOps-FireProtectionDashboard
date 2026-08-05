"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CrmAttachmentRecord, CrmEntityType } from "@/lib/crm/crmTypes";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function CrmAttachmentList({
  entityType,
  entityId,
  accountId,
  canEdit,
}: {
  entityType: CrmEntityType;
  entityId: string;
  accountId?: string | null;
  canEdit: boolean;
}) {
  const [attachments, setAttachments] = useState<CrmAttachmentRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ entityType, entityId });
      const res = await fetch(`/api/crm/attachments?${params.toString()}`, { cache: "no-store" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to load attachments");
      setAttachments(payload.attachments || []);
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleFile = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const urlRes = await fetch("/api/crm/attachments/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType, entityId, contentType: file.type || "application/octet-stream" }),
      });
      const urlPayload = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlPayload.error || "Failed to get upload URL");

      const putRes = await fetch(urlPayload.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!putRes.ok) throw new Error("Upload to storage failed");

      const confirmRes = await fetch("/api/crm/attachments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType,
          entityId,
          accountId,
          r2Key: urlPayload.r2Key,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          fileName: file.name,
        }),
      });
      if (!confirmRes.ok) {
        const confirmPayload = await confirmRes.json();
        throw new Error(confirmPayload.error || "Failed to save attachment");
      }
      await load();
    } catch (uploadError) {
      setError((uploadError as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const deleteAttachment = async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/crm/attachments/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error || "Failed to delete attachment");
      }
      await load();
    } catch (deleteError) {
      setError((deleteError as Error).message);
    }
  };

  return (
    <div>
      {error ? <p className="mb-2 text-sm text-rose-600">{error}</p> : null}

      {canEdit ? (
        <div className="mb-3">
          <input
            ref={fileInputRef}
            type="file"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
            className="text-xs text-slate-500 file:mr-2 file:rounded-lg file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-white hover:file:bg-blue-700"
          />
          {uploading ? <span className="ml-2 text-xs text-slate-400">Uploading…</span> : null}
        </div>
      ) : null}

      {attachments.length === 0 ? (
        <p className="text-sm text-slate-500">No files.</p>
      ) : (
        <ul className="space-y-1">
          {attachments.map((attachment) => (
            <li key={attachment.id} className="flex items-center justify-between text-sm">
              {attachment.url ? (
                <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline dark:text-blue-400">
                  {attachment.fileName || "file"}
                </a>
              ) : (
                <span className="text-slate-600 dark:text-slate-300">{attachment.fileName || "file"}</span>
              )}
              <span className="flex items-center gap-2 text-xs text-slate-400">
                {formatSize(attachment.sizeBytes)}
                {canEdit ? (
                  <button type="button" onClick={() => void deleteAttachment(attachment.id)} className="text-rose-500 hover:underline">
                    Delete
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
