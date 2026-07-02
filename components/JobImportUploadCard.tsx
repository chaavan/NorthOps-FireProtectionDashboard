'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createImportUploadAbortSignal,
  isAcceptableJobImportPdf,
  isDragLeaveForCurrentZone,
  JOB_IMPORT_MAX_PDF_BYTES,
  parseImportPostJson,
} from '@/lib/jobImportUploadClient';

interface JobImportUploadCardProps {
  canUpload?: boolean;
  canCreateManualJob?: boolean;
  onDraftCreated?: () => void;
}

type UploadQueueStatus = 'queued' | 'uploading' | 'ready' | 'error';

interface UploadQueueItem {
  id: string;
  file: File;
  fileName: string;
  status: UploadQueueStatus;
  message?: string | null;
  importId?: string | null;
}

function createQueueId(file: File, index: number): string {
  return `${Date.now()}-${index}-${file.name}-${file.size}`;
}

function formatFileSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dragEventHasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types || []).includes('Files');
}

export default function JobImportUploadCard({
  canUpload = false,
  canCreateManualJob = false,
  onDraftCreated,
}: JobImportUploadCardProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);

  const uploadQueueItem = useCallback(
    async (item: UploadQueueItem) => {
      const { signal, cancel } = createImportUploadAbortSignal();
      try {
        setQueue((current) =>
          current.map((candidate) =>
            candidate.id === item.id
              ? { ...candidate, status: 'uploading', message: 'Creating draft...' }
              : candidate,
          ),
        );

        const formData = new FormData();
        formData.append('file', item.file);

        const response = await fetch('/api/job-imports', {
          method: 'POST',
          body: formData,
          signal,
        });

        const data = await parseImportPostJson(response);
        const importId = (data.import as { id?: string } | undefined)?.id;
        if (!importId) {
          throw new Error('Import session was created without an id.');
        }

        setQueue((current) =>
          current.map((candidate) =>
            candidate.id === item.id
              ? { ...candidate, status: 'ready', importId, message: 'Draft ready to review.' }
              : candidate,
          ),
        );
        onDraftCreated?.();
      } catch (uploadError) {
        const message =
          uploadError instanceof DOMException && uploadError.name === 'AbortError'
            ? 'Upload timed out after 15 minutes. Try again or use a faster connection.'
            : (uploadError as Error).message || 'Failed to upload PDF.';
        setQueue((current) =>
          current.map((candidate) =>
            candidate.id === item.id ? { ...candidate, status: 'error', message } : candidate,
          ),
        );
      } finally {
        cancel();
      }
    },
    [onDraftCreated],
  );

  const enqueueFiles = useCallback(
    async (source: FileList | File[]) => {
      if (!canUpload || isProcessingQueue) return;
      const files = Array.from(source);
      if (files.length === 0) {
        setError('No file received. Try Browse or drag the file from File Explorer.');
        setUploadNotice(null);
        return;
      }

      const accepted: UploadQueueItem[] = [];
      const rejected: string[] = [];
      files.forEach((file, index) => {
        if (!isAcceptableJobImportPdf(file)) {
          rejected.push(`${file.name}: not a PDF`);
          return;
        }
        if (file.size > JOB_IMPORT_MAX_PDF_BYTES) {
          rejected.push(`${file.name}: too large (${formatFileSize(file.size)})`);
          return;
        }
        accepted.push({
          id: createQueueId(file, index),
          file,
          fileName: file.name,
          status: 'queued',
          message: 'Queued',
        });
      });

      if (accepted.length === 0) {
        setError(rejected.length > 0 ? rejected.join('; ') : 'Please upload a PDF file (.pdf).');
        setUploadNotice(null);
        return;
      }

      setError(null);
      setUploadNotice(
        rejected.length > 0
          ? `${accepted.length} PDF${accepted.length === 1 ? '' : 's'} queued. Skipped: ${rejected.join('; ')}`
          : `${accepted.length} PDF${accepted.length === 1 ? '' : 's'} queued for import.`,
      );
      setQueue((current) => [...accepted, ...current].slice(0, 12));
      setIsProcessingQueue(true);
      try {
        for (const item of accepted) {
          await uploadQueueItem(item);
        }
      } finally {
        setIsProcessingQueue(false);
      }
    },
    [canUpload, isProcessingQueue, uploadQueueItem],
  );

  const openFilePicker = () => {
    if (!canUpload || isProcessingQueue) return;
    inputRef.current?.click();
  };

  const onFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    void enqueueFiles(event.target.files || []);
    event.currentTarget.value = '';
  };

  const isUploading = isProcessingQueue || queue.some((item) => item.status === 'uploading');

  useEffect(() => {
    if (!canUpload) return;

    const onWindowDragOver = (event: DragEvent) => {
      if (!dragEventHasFiles(event)) return;
      event.preventDefault();
      if (isProcessingQueue) return;
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
      setIsDragging(true);
    };

    const onWindowDragLeave = (event: DragEvent) => {
      if (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight) {
        setIsDragging(false);
      }
    };

    const onWindowDrop = (event: DragEvent) => {
      if (!dragEventHasFiles(event)) return;
      event.preventDefault();
      setIsDragging(false);
      if (isProcessingQueue || !event.dataTransfer?.files) return;
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
  }, [canUpload, enqueueFiles, isProcessingQueue]);

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-800/60 p-4 sm:p-5 lg:p-6 shadow-sm dark:shadow-none">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base sm:text-lg lg:text-xl font-bold text-slate-900 dark:text-white">
          Picksheet Import
        </h2>
        {canCreateManualJob && (
          <button
            type="button"
            onClick={() => router.push('/jobs/create')}
            className="shrink-0 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-all shadow-sm hover:shadow-md flex items-center gap-2 text-sm"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            Manual Entry
          </button>
        )}
      </div>

      <div
        onDragEnter={(event) => {
          event.preventDefault();
          if (!canUpload || isUploading) return;
          setIsDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!canUpload || isUploading) return;
          event.dataTransfer.dropEffect = 'copy';
          setIsDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          if (!isDragLeaveForCurrentZone(event, event.currentTarget)) return;
          setIsDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setIsDragging(false);
          void enqueueFiles(event.dataTransfer.files);
        }}
        onClick={openFilePicker}
        onKeyDown={(event) => {
          if (!canUpload || isUploading) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openFilePicker();
          }
        }}
        role={canUpload ? 'button' : undefined}
        tabIndex={canUpload && !isUploading ? 0 : undefined}
        aria-label={canUpload ? 'Upload picksheet PDF' : undefined}
        className={`relative mt-4 sm:mt-5 rounded-2xl border-2 border-dashed px-5 py-6 sm:px-6 sm:py-7 lg:px-8 lg:py-8 min-h-[180px] sm:min-h-[210px] lg:min-h-[240px] text-center transition-all flex items-center justify-center ${
          isDragging
            ? 'border-blue-500 bg-blue-50 dark:bg-slate-700/50'
            : 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/20'
        } ${canUpload ? 'cursor-pointer' : 'opacity-70 cursor-not-allowed'}`}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          disabled={!canUpload || isUploading}
          onChange={onFileInputChange}
          className="sr-only"
          tabIndex={-1}
        />

        {isUploading ? (
          <div className="pointer-events-none space-y-2.5 sm:space-y-3">
            <div className="mx-auto h-10 w-10 sm:h-11 sm:w-11 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
            <p className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white">
              Building import draft…
            </p>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              Header-only picklists are detected automatically and complete quickly. Full picklists may take several
              minutes (Document AI + OpenAI).
            </p>
          </div>
        ) : (
          <div className="pointer-events-none space-y-2.5 sm:space-y-3">
            <div className="mx-auto flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
              <svg className="h-6 w-6 sm:h-7 sm:w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
            </div>
            <p className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white">
              Drop a picksheet here or click to browse
            </p>
          </div>
        )}
      </div>

      {uploadNotice && (
        <div className="mt-3 sm:mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs sm:text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          {uploadNotice}
        </div>
      )}

      {error && (
        <div className="mt-3 sm:mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs sm:text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
          {error}
        </div>
      )}

      {!canUpload && (
        <p className="mt-3 sm:mt-4 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
          Uploading new import drafts is turned off for your account.
        </p>
      )}

      {queue.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Upload Queue</h3>
            <button
              type="button"
              onClick={() => setQueue((current) => current.filter((item) => item.status === 'uploading'))}
              disabled={isUploading}
              className="text-xs font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Clear finished
            </button>
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {queue.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{item.fileName}</p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{item.message}</p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      item.status === 'ready'
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200'
                        : item.status === 'error'
                          ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-200'
                          : item.status === 'uploading'
                            ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-200'
                    }`}
                  >
                    {item.status === 'uploading'
                      ? 'Uploading'
                      : item.status === 'ready'
                        ? 'Ready'
                        : item.status === 'error'
                          ? 'Error'
                          : 'Queued'}
                  </span>
                </div>
                {item.importId && (
                  <button
                    type="button"
                    onClick={() => router.push(`/jobs/import/${encodeURIComponent(item.importId || '')}`)}
                    className="mt-2 text-xs font-semibold text-blue-700 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
                  >
                    Open draft
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
