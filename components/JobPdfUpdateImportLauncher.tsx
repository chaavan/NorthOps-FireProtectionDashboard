'use client';

import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useJobImportPdfDropZone } from '@/lib/hooks/useJobImportPdfDropZone';
import {
  createImportUploadAbortSignal,
  parseImportPostJson,
} from '@/lib/jobImportUploadClient';

interface JobPdfUpdateImportLauncherProps {
  jobNumber: string;
  jobName: string;
  listNumberContext?: string | null;
  canEdit?: boolean;
  variant?: 'modal' | 'inline';
  triggerLabel?: string;
  triggerClassName?: string;
}

function PdfUpdateDropZoneShell({
  isDragging,
  canEdit,
  isUploading,
  dropZoneProps,
  openFilePicker,
  inputRef,
  inputId,
  onFileInputChange,
  listNumberContext,
  variant,
}: {
  isDragging: boolean;
  canEdit: boolean;
  isUploading: boolean;
  dropZoneProps: ReturnType<typeof useJobImportPdfDropZone>['dropZoneProps'];
  openFilePicker: () => void;
  inputRef: React.RefObject<HTMLInputElement>;
  inputId: string;
  onFileInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  listNumberContext?: string | null;
  variant: 'modal' | 'inline';
}) {
  const padding =
    variant === 'inline'
      ? 'px-6 py-8 sm:px-8 sm:py-10'
      : 'px-6 py-10';

  return (
    <div
      {...dropZoneProps}
      onClick={openFilePicker}
      onKeyDown={(event) => {
        if (!canEdit || isUploading) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openFilePicker();
        }
      }}
      role={canEdit ? 'button' : undefined}
      tabIndex={canEdit && !isUploading ? 0 : undefined}
      aria-label={canEdit ? 'Upload PDF to update job' : undefined}
      className={`relative rounded-2xl border-2 border-dashed text-center transition-all ${padding} ${
        isDragging
          ? 'border-blue-500 bg-blue-50 dark:bg-slate-700/50'
          : 'border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-900/20'
      } ${canEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept=".pdf,application/pdf"
        disabled={!canEdit || isUploading}
        onChange={onFileInputChange}
        className="sr-only"
        tabIndex={-1}
      />

      {isUploading ? (
        <div className="pointer-events-none space-y-3">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            {variant === 'inline' ? 'Building PDF update review...' : 'Building PDF update review…'}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Large PDFs can take several minutes while we run OCR and prepare merge decisions.
          </p>
        </div>
      ) : (
        <div className="pointer-events-none space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
          </div>
          <p
            className={
              variant === 'inline'
                ? 'text-base font-semibold text-slate-900 dark:text-white'
                : 'text-sm font-semibold text-slate-900 dark:text-white'
            }
          >
            Drop a PDF here or click to browse
          </p>
          {variant === 'inline' ? (
            <>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Update this job from a TF picksheet or marked-up PDF without opening a pop-up.
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Target list:{' '}
                {listNumberContext && listNumberContext !== '__ALL__'
                  ? listNumberContext
                  : 'choose during review if needed'}
              </p>
            </>
          ) : (
            <p className="text-xs text-slate-600 dark:text-slate-400">
              We will keep this locked to the current job and review all changes before commit.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function JobPdfUpdateImportLauncher({
  jobNumber,
  jobName,
  listNumberContext,
  canEdit = false,
  variant = 'modal',
  triggerLabel = 'Import PDF',
  triggerClassName = '',
}: JobPdfUpdateImportLauncherProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);

  const uploadUrl = useMemo(() => {
    const query = new URLSearchParams();
    if (listNumberContext && listNumberContext.trim() && listNumberContext !== '__ALL__') {
      query.set('listNumber', listNumberContext.trim());
    }
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return `/api/jobs/${encodeURIComponent(jobNumber)}/pdf-update-imports${suffix}`;
  }, [jobNumber, listNumberContext]);

  const uploadFile = useCallback(
    async (file: File) => {
      if (!canEdit) return;

      setIsUploading(true);
      setError(null);
      setUploadNotice(null);

      const { signal, cancel } = createImportUploadAbortSignal();
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('jobName', jobName);

        const response = await fetch(uploadUrl, {
          method: 'POST',
          body: formData,
          signal,
        });

        const data = await parseImportPostJson(response);
        const importId = (data.import as { id?: string } | undefined)?.id;
        if (!importId) {
          throw new Error('Import session was created without an id.');
        }

        setIsOpen(false);
        router.push(`/jobs/import/${encodeURIComponent(importId)}`);
      } catch (uploadError) {
        if (uploadError instanceof DOMException && uploadError.name === 'AbortError') {
          setError(
            'Upload timed out after 15 minutes. Large PDFs can take a long time—try again or use a faster connection.',
          );
        } else {
          setError((uploadError as Error).message || 'Failed to upload PDF.');
        }
      } finally {
        cancel();
        setIsUploading(false);
      }
    },
    [canEdit, jobName, router, uploadUrl],
  );

  const { dropZoneProps, inputRef, inputId, openFilePicker, onFileInputChange } = useJobImportPdfDropZone({
    canEdit,
    isUploading,
    setIsDragging,
    reportError: setError,
    setUploadNotice,
    onFile: (file) => {
      void uploadFile(file);
    },
  });

  if (variant === 'inline') {
    return (
      <div className="w-full max-w-2xl mx-auto">
        <PdfUpdateDropZoneShell
          isDragging={isDragging}
          canEdit={canEdit}
          isUploading={isUploading}
          dropZoneProps={dropZoneProps}
          openFilePicker={openFilePicker}
          inputRef={inputRef}
          inputId={inputId}
          onFileInputChange={onFileInputChange}
          listNumberContext={listNumberContext}
          variant="inline"
        />

        {uploadNotice && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
            {uploadNotice}
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (!canEdit) return;
          setError(null);
          setUploadNotice(null);
          setIsOpen(true);
        }}
        disabled={!canEdit}
        className={triggerClassName}
      >
        {triggerLabel}
      </button>

      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[300] flex min-h-[100dvh] items-center justify-center overflow-y-auto bg-slate-950/55 px-4 py-8 backdrop-blur-md dark:bg-slate-950/70"
            role="presentation"
          >
            <div
              className="relative z-10 my-auto w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-800"
              role="dialog"
              aria-modal="true"
              aria-labelledby="pdf-import-modal-title"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2
                    id="pdf-import-modal-title"
                    className="text-xl font-bold text-slate-900 dark:text-white"
                  >
                    Update Job From PDF
                  </h2>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    Upload a TF picksheet or marked-up PDF for job {jobNumber}. We will review changes
                    before applying them.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  Close
                </button>
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-300">
                <p className="font-semibold text-slate-900 dark:text-white">{jobName}</p>
                <p className="mt-1">
                  Target list:{' '}
                  {listNumberContext && listNumberContext !== '__ALL__'
                    ? listNumberContext
                    : 'All lists view - you will confirm the target list during review if needed.'}
                </p>
              </div>

              <div className="mt-5">
                <PdfUpdateDropZoneShell
                  isDragging={isDragging}
                  canEdit={canEdit}
                  isUploading={isUploading}
                  dropZoneProps={dropZoneProps}
                  openFilePicker={openFilePicker}
                  inputRef={inputRef}
                  inputId={inputId}
                  onFileInputChange={onFileInputChange}
                  listNumberContext={listNumberContext}
                  variant="modal"
                />
              </div>

              {uploadNotice && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
                  {uploadNotice}
                </div>
              )}

              {error && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
                  {error}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
