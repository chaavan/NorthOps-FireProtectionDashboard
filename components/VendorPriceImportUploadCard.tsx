'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const ALLOWED_EXTENSIONS = ['xlsx', 'xls', 'csv'];
const MAX_BYTES = 15 * 1024 * 1024;

function extensionOf(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() || '';
}

function isAcceptableFile(file: File): boolean {
  return ALLOWED_EXTENSIONS.includes(extensionOf(file.name));
}

function formatFileSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dragEventHasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types || []).includes('Files');
}

interface VendorProfile {
  vendorKey: string;
  displayName: string;
}

interface VendorPriceImportUploadCardProps {
  canEdit?: boolean;
  profiles: VendorProfile[];
  defaultVendorKey?: string;
}

export default function VendorPriceImportUploadCard({
  canEdit = false,
  profiles,
  defaultVendorKey = 'etna',
}: VendorPriceImportUploadCardProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [vendorKey, setVendorKey] = useState(defaultVendorKey);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (profiles.some((p) => p.vendorKey === defaultVendorKey)) {
      setVendorKey(defaultVendorKey);
    } else if (profiles[0]) {
      setVendorKey(profiles[0].vendorKey);
    }
  }, [profiles, defaultVendorKey]);

  const uploadFile = useCallback(
    async (file: File) => {
      if (!canEdit) return;
      setIsUploading(true);
      setError(null);
      setNotice(`Uploading ${file.name}…`);

      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('vendorKey', vendorKey);

        const response = await fetch('/api/vendor-price-imports', {
          method: 'POST',
          body: formData,
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Upload failed.');
        }
        const importId = data.import?.id;
        if (!importId) throw new Error('Import was created without an id.');
        setNotice(null);
        router.push(`/parts/price-updates/${encodeURIComponent(importId)}`);
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : 'Upload failed.');
        setNotice(null);
      } finally {
        setIsUploading(false);
      }
    },
    [canEdit, router, vendorKey],
  );

  const enqueueFiles = useCallback(
    async (source: FileList | File[]) => {
      if (!canEdit || isUploading) return;
      const files = Array.from(source);
      if (files.length === 0) {
        setError('No file received.');
        return;
      }
      const file = files[0];
      if (files.length > 1) {
        setNotice('Only the first file will be imported.');
      }
      if (!isAcceptableFile(file)) {
        setError(`Unsupported file. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
        return;
      }
      if (file.size > MAX_BYTES) {
        setError(`File too large (${formatFileSize(file.size)}). Max ${formatFileSize(MAX_BYTES)}.`);
        return;
      }
      await uploadFile(file);
    },
    [canEdit, isUploading, uploadFile],
  );

  useEffect(() => {
    if (!canEdit) return;

    const onWindowDragOver = (event: DragEvent) => {
      if (!dragEventHasFiles(event)) return;
      event.preventDefault();
      if (isUploading) return;
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      setIsDragging(true);
    };

    const onWindowDragLeave = (event: DragEvent) => {
      if (
        event.clientX <= 0 ||
        event.clientY <= 0 ||
        event.clientX >= window.innerWidth ||
        event.clientY >= window.innerHeight
      ) {
        setIsDragging(false);
      }
    };

    const onWindowDrop = (event: DragEvent) => {
      if (!dragEventHasFiles(event)) return;
      event.preventDefault();
      setIsDragging(false);
      if (isUploading || !event.dataTransfer?.files?.length) return;
      void enqueueFiles(event.dataTransfer.files);
    };

    window.addEventListener('dragover', onWindowDragOver);
    window.addEventListener('dragleave', onWindowDragLeave);
    window.addEventListener('drop', onWindowDrop);
    return () => {
      window.removeEventListener('dragover', onWindowDragOver);
      window.removeEventListener('dragleave', onWindowDragLeave);
      window.removeEventListener('drop', onWindowDrop);
    };
  }, [canEdit, isUploading, enqueueFiles]);

  return (
    <div className="flex-shrink-0">
      <div className="flex flex-wrap items-end gap-4 mb-4">
        <div className="min-w-[12rem]">
          <label htmlFor={`${inputId}-vendor`} className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">
            Vendor
          </label>
          <select
            id={`${inputId}-vendor`}
            value={vendorKey}
            onChange={(e) => setVendorKey(e.target.value)}
            disabled={!canEdit || isUploading}
            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-600/80 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white text-sm shadow-sm hover:border-slate-400 dark:hover:border-slate-500/80 transition-all"
          >
            {profiles.map((p) => (
              <option key={p.vendorKey} value={p.vendorKey}>
                {p.displayName}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div
        className={`relative rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
          isDragging
            ? 'border-blue-500 dark:bg-blue-500/10'
            : 'border-slate-300 dark:border-slate-600/80'
        } ${!canEdit ? 'opacity-60 pointer-events-none' : ''}`}
      >
        <p className="text-sm font-medium text-slate-900 dark:text-white">
          Drag and drop vendor price sheet here
        </p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(', ')} — max {formatFileSize(MAX_BYTES)}
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={!canEdit || isUploading}
          className="mt-4 px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isUploading ? 'Processing…' : 'Browse files'}
        </button>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',')}
          className="hidden"
          onChange={(e) => {
            void enqueueFiles(e.target.files || []);
            e.currentTarget.value = '';
          }}
        />
      </div>

      {notice && <p className="mt-3 text-sm text-blue-700 dark:text-blue-300">{notice}</p>}
      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-300">{error}</p>}
    </div>
  );
}
