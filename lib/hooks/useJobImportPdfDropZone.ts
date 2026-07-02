'use client';

import { useCallback, useId, useRef } from 'react';
import {
  isDragLeaveForCurrentZone,
  resolvePdfFromFileList,
} from '@/lib/jobImportUploadClient';

type UseJobImportPdfDropZoneParams = {
  canEdit: boolean;
  isUploading: boolean;
  setIsDragging: (value: boolean) => void;
  reportError: (message: string | null) => void;
  setUploadNotice: (message: string | null) => void;
  onFile: (file: File) => void;
};

export function useJobImportPdfDropZone({
  canEdit,
  isUploading,
  setIsDragging,
  reportError,
  setUploadNotice,
  onFile,
}: UseJobImportPdfDropZoneParams) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const applyFileList = useCallback(
    (source: FileList | null) => {
      const resolved = resolvePdfFromFileList(source);
      if (!resolved.ok) {
        reportError(resolved.error);
        setUploadNotice(null);
        return;
      }
      reportError(null);
      setUploadNotice(resolved.info ?? null);
      onFile(resolved.file);
    },
    [onFile, reportError, setUploadNotice],
  );

  const onDragEnter = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (!canEdit || isUploading) return;
      setIsDragging(true);
    },
    [canEdit, isUploading, setIsDragging],
  );

  const onDragOver = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (!canEdit || isUploading) return;
      try {
        event.dataTransfer.dropEffect = 'copy';
      } catch {
        /* ignore */
      }
      setIsDragging(true);
    },
    [canEdit, isUploading, setIsDragging],
  );

  const onDragLeave = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (!isDragLeaveForCurrentZone(event, event.currentTarget)) return;
      setIsDragging(false);
    },
    [setIsDragging],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);
      if (!canEdit || isUploading) return;
      applyFileList(event.dataTransfer.files);
    },
    [applyFileList, canEdit, isUploading, setIsDragging],
  );

  const openFilePicker = useCallback(() => {
    if (!canEdit || isUploading) return;
    inputRef.current?.click();
  }, [canEdit, isUploading]);

  const onFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      applyFileList(event.target.files);
      event.currentTarget.value = '';
    },
    [applyFileList],
  );

  const dropZoneProps = {
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
  };

  return {
    inputRef,
    inputId,
    dropZoneProps,
    openFilePicker,
    onFileInputChange,
  };
}
