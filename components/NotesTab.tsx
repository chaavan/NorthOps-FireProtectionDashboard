'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { formatDateInAppTimeZone } from '@/lib/timezone';
import type { JobImportRecordResponse } from '@/lib/jobImportTypes';
import { uploadNoteAttachments } from '@/lib/noteAttachmentUploadClient';
import {
  formatDeliveryDateChangeBadge,
  JOB_NOTE_KIND_DELIVERY_DATE_CHANGE,
} from '@/lib/jobNotes';

interface JobNoteAttachment {
  id: string;
  noteId: string;
  jobNumber: string;
  r2Key: string;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  fileName: string | null;
  createdBy: string | null;
  createdAt: string;
  url: string;
}

interface JobNote {
  id: string;
  jobNumber: string;
  content: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  parentId?: string | null;
  noteKind?: string | null;
  deliveryDateFrom?: string | null;
  deliveryDateTo?: string | null;
  attachments?: JobNoteAttachment[];
}

interface PackingSlipAttachment {
  id: string;
  jobNumber: string;
  listNumber: string | null;
  fileName: string;
  contentType: string | null;
  size: number | null;
  uploadedBy: string;
  uploadedAt: string;
  url: string;
}

/** Scroll within a scrollable panel only (avoids scrollIntoView moving the document viewport). */
function scrollChildIntoScrollContainer(
  container: HTMLElement,
  child: HTMLElement,
  paddingTop = 16,
) {
  const cRect = container.getBoundingClientRect();
  const eRect = child.getBoundingClientRect();
  const nextTop = container.scrollTop + (eRect.top - cRect.top) - paddingTop;
  container.scrollTo({
    top: Math.max(0, nextTop),
    behavior: 'smooth',
  });
}

interface NotesTabProps {
  jobNumber: string;
  jobName: string;
  listNumberContext?: string | null;
  // When arriving from a notification email, openNoteId allows auto-scrolling to the exact note card.
  openNoteId?: string | null;
  onDeepLinkConsumed?: (() => void) | null;
  canAddEditNotes?: boolean;
  canDeleteNotes?: boolean;
  canUploadPackingSlips?: boolean;
}

export default function NotesTab({
  jobNumber,
  jobName,
  listNumberContext,
  openNoteId,
  onDeepLinkConsumed,
  canAddEditNotes = false,
  canDeleteNotes = false,
  canUploadPackingSlips = false,
}: NotesTabProps) {
  const [notes, setNotes] = useState<JobNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Reserved for a future notification flow (banner UI below stays wired to this state). */
  const [notificationWarning, setNotificationWarning] = useState<string | null>(null);
  const [highlightedNoteId, setHighlightedNoteId] = useState<string | null>(null);
  
  const { isAdmin, isPrivileged, user } = useAuth();
  const isNoteAuthor = (note: JobNote): boolean => {
    if (isAdmin || isPrivileged) return true;
    const currentUserName = user?.name || user?.email;
    return note.createdBy === currentUserName;
  };
  // Form states
  const [newNoteContent, setNewNoteContent] = useState('');
  const [newNoteFiles, setNewNoteFiles] = useState<File[]>([]);
  const [uploadingNoteId, setUploadingNoteId] = useState<string | null>(null);
  const [isNewNoteDragActive, setIsNewNoteDragActive] = useState(false);

  // Camera capture (works on devices with cameras via getUserMedia)
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraTargetNoteId, setCameraTargetNoteId] = useState<string | null>(null); // null => new note
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraFiles, setCameraFiles] = useState<File[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const normalizedListContext =
    typeof listNumberContext === 'string' &&
    listNumberContext.trim().length > 0 &&
    listNumberContext.trim() !== '__ALL__'
      ? listNumberContext.trim()
      : null;
  const withListContext = (path: string) => {
    if (!normalizedListContext) return path;
    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}listNumber=${encodeURIComponent(normalizedListContext)}`;
  };

  // Edit and delete states
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteContent, setEditNoteContent] = useState('');
  const [originalNoteContent, setOriginalNoteContent] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEditConfirm, setShowEditConfirm] = useState(false);
  const [showAddNoteModal, setShowAddNoteModal] = useState(false);

  // Reply (thread) state
  const [replyingToRootId, setReplyingToRootId] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState('');

  // Packing slips
  const [activeView, setActiveView] = useState<'notes' | 'packing-slips' | 'import-history'>('notes');
  const [packingSlips, setPackingSlips] = useState<PackingSlipAttachment[]>([]);
  const [isLoadingPackingSlips, setIsLoadingPackingSlips] = useState(false);
  const [packingSlipError, setPackingSlipError] = useState<string | null>(null);
  const [importHistory, setImportHistory] = useState<JobImportRecordResponse[]>([]);
  const [isLoadingImportHistory, setIsLoadingImportHistory] = useState(false);
  const [importHistoryError, setImportHistoryError] = useState<string | null>(null);

  const hasAutoScrolledForDeepLinkRef = useRef(false);
  const notesListScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Reset only when a new deep link arrives (openNoteId becomes a new non-null value).
    if (!openNoteId) return;
    hasAutoScrolledForDeepLinkRef.current = false;
    setHighlightedNoteId(null);
  }, [openNoteId]);

  // Load notes
  useEffect(() => {
    loadData();
    loadPackingSlips();
    loadImportHistory();
  }, [jobNumber, normalizedListContext]);

  // Deep-link handling: scroll + highlight the exact note card when notes are loaded.
  useEffect(() => {
    if (!openNoteId) return;
    if (hasAutoScrolledForDeepLinkRef.current) return;
    if (isLoading) return;
    if (activeView !== 'notes') {
      // Ensure the notes view is visible; we'll scroll on the next render.
      setActiveView('notes');
      return;
    }

    const targetEl = document.getElementById(`note-${openNoteId}`);
    const listEl = notesListScrollRef.current;
    if (targetEl && listEl?.contains(targetEl)) {
      scrollChildIntoScrollContainer(listEl, targetEl, 16);
      setHighlightedNoteId(openNoteId);
      window.setTimeout(() => setHighlightedNoteId(null), 4500);
    }

    hasAutoScrolledForDeepLinkRef.current = true;
    onDeepLinkConsumed?.();
  }, [activeView, isLoading, notes.length, onDeepLinkConsumed, openNoteId]);

  const cameraObjectUrls = useMemo(() => {
    return cameraFiles.map((f) => ({ file: f, url: URL.createObjectURL(f) }));
  }, [cameraFiles]);

  const newNoteObjectUrls = useMemo(() => {
    return newNoteFiles.map((f) => ({ file: f, url: URL.createObjectURL(f) }));
  }, [newNoteFiles]);

  useEffect(() => {
    return () => {
      cameraObjectUrls.forEach(({ url }) => URL.revokeObjectURL(url));
    };
  }, [cameraObjectUrls]);

  useEffect(() => {
    return () => {
      newNoteObjectUrls.forEach(({ url }) => URL.revokeObjectURL(url));
    };
  }, [newNoteObjectUrls]);

  const stopCamera = () => {
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }
    streamRef.current = null;
    if (videoRef.current) {
      try {
        (videoRef.current as HTMLVideoElement & { srcObject?: MediaStream | null }).srcObject = null;
      } catch {
        // ignore
      }
    }
  };

  const startCamera = async () => {
    setCameraError(null);
    stopCamera();

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera not supported in this browser/device.');
      return;
    }

    // Try rear camera first; fall back to any camera.
    const tryConstraints: MediaStreamConstraints[] = [
      { video: { facingMode: { ideal: 'environment' } }, audio: false },
      { video: { facingMode: { ideal: 'user' } }, audio: false },
      { video: true, audio: false },
    ];

    let lastErr: unknown = null;
    for (const constraints of tryConstraints) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;

        if (videoRef.current) {
          (videoRef.current as HTMLVideoElement & { srcObject?: MediaStream | null }).srcObject = stream;
          await videoRef.current.play();
        }
        return;
      } catch (err) {
        lastErr = err;
      }
    }

    console.error('Failed to start camera:', lastErr);
    setCameraError('Could not access camera. Please allow camera permissions and try again.');
  };

  useEffect(() => {
    if (!isCameraOpen) {
      stopCamera();
      setCameraError(null);
      setCameraFiles([]);
      setCameraTargetNoteId(null);
      return;
    }

    startCamera();
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCameraOpen]);

  const captureFromCamera = async () => {
    const video = videoRef.current;
    if (!video) throw new Error('Camera not ready');
    if (!video.videoWidth || !video.videoHeight) throw new Error('Camera not ready');

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not capture photo');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (!b) return reject(new Error('Failed to capture photo'));
          resolve(b);
        },
        'image/jpeg',
        0.92
      );
    });

    const filename = `camera-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
    return new File([blob], filename, { type: blob.type });
  };

  const loadPackingSlips = async () => {
    if (!jobNumber) return;
    try {
      setIsLoadingPackingSlips(true);
      setPackingSlipError(null);
      const res = await fetch(
        withListContext(`/api/jobs/${encodeURIComponent(jobNumber)}/packing-slips`)
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Failed to load packing slips');
      }
      const data = await res.json();
      setPackingSlips(data.attachments || []);
    } catch (err) {
      console.error('Error loading packing slips:', err);
      setPackingSlipError((err as Error).message);
    } finally {
      setIsLoadingPackingSlips(false);
    }
  };

  const loadImportHistory = async () => {
    if (!jobNumber) return;
    try {
      setIsLoadingImportHistory(true);
      setImportHistoryError(null);
      const res = await fetch(
        withListContext(`/api/jobs/${encodeURIComponent(jobNumber)}/pdf-update-imports`)
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Failed to load PDF import history');
      }
      const data = await res.json();
      setImportHistory(Array.isArray(data.imports) ? data.imports : []);
    } catch (err) {
      console.error('Error loading PDF import history:', err);
      setImportHistoryError((err as Error).message);
    } finally {
      setIsLoadingImportHistory(false);
    }
  };

  const handlePackingSlipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    try {
      setPackingSlipError(null);
      const formData = new FormData();
      Array.from(files).forEach((file) => formData.append('files', file));
      const res = await fetch(
        withListContext(`/api/jobs/${encodeURIComponent(jobNumber)}/packing-slips`),
        { method: 'POST', body: formData }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Failed to upload packing slips');
      }
      await loadPackingSlips();
      e.target.value = '';
    } catch (err) {
      console.error('Error uploading packing slips:', err);
      setPackingSlipError((err as Error).message);
    }
  };

  const handlePackingSlipDelete = async (id: string) => {
    try {
      setPackingSlipError(null);
      const query = new URLSearchParams({ id });
      if (normalizedListContext) query.set('listNumber', normalizedListContext);
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(jobNumber)}/packing-slips?${query.toString()}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Failed to delete packing slip');
      }
      setPackingSlips((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error('Error deleting packing slip:', err);
      setPackingSlipError((err as Error).message);
    }
  };

  const loadData = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const notesRes = await fetch(
        withListContext(`/api/jobs/${encodeURIComponent(jobNumber)}/notes`)
      );

      if (!notesRes.ok) {
        let details = '';
        try {
          const errJson = await notesRes.json();
          details = errJson?.error || errJson?.message || JSON.stringify(errJson);
        } catch {
          try {
            details = await notesRes.text();
          } catch {
            details = '';
          }
        }
        const suffix = details ? `: ${details}` : '';
        throw new Error(`Failed to load notes (${notesRes.status})${suffix}`);
      }

      const notesData = await notesRes.json();
      setNotes(notesData.notes || []);
    } catch (err) {
      console.error('Error loading notes:', err);
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  // Thread view: root notes (no parentId) desc by date; replies under each root asc by date
  const { rootNotes, repliesByRootId } = useMemo(() => {
    const roots = notes.filter((n) => !n.parentId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const byRoot = new Map<string, JobNote[]>();
    for (const n of notes) {
      if (n.parentId) {
        const arr = byRoot.get(n.parentId) || [];
        arr.push(n);
        byRoot.set(n.parentId, arr);
      }
    }
    byRoot.forEach((arr) => arr.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
    return { rootNotes: roots, repliesByRootId: byRoot };
  }, [notes]);

  const compressImageToWebP = async (
    file: File,
    opts: { maxDimension: number; quality: number }
  ): Promise<{ blob: Blob; width: number; height: number }> => {
    const { maxDimension, quality } = opts;

    // Validate file before processing
    if (!file || file.size === 0) {
      throw new Error(`Invalid file: ${file?.name || 'unknown'} (size: ${file?.size || 0} bytes)`);
    }

    if (file.size > 50 * 1024 * 1024) { // 50MB limit
      throw new Error(`File too large: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB). Maximum size: 50MB`);
    }

    // Log file info for debugging iPad/HEIC issues
    const fileType = file.type || 'unknown';
    const fileName = file.name.toLowerCase();
    const isHeic = fileName.endsWith('.heic') || fileName.endsWith('.heif') || fileType.includes('heic') || fileType.includes('heif');
    
    // Check if file is actually an image (unless it's HEIC which might not have proper MIME type)
    if (fileType && !fileType.startsWith('image/') && !isHeic && fileType !== 'unknown' && fileType !== 'application/octet-stream') {
      throw new Error(`Not an image file: ${file.name} (type: ${fileType}). Please use JPEG, PNG, WebP, or HEIC images.`);
    }
    
    console.log(`Processing file: ${file.name}`, {
      size: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
      type: fileType,
      isHeic,
      lastModified: new Date(file.lastModified).toISOString(),
    });
    
    if (isHeic || !fileType || fileType === 'unknown' || fileType === 'application/octet-stream') {
      console.warn(`Processing file with type "${fileType}": ${file.name}. This might be HEIC format from iPad.`);
    }

    // Decode image - use Image element for better iPad/HEIC compatibility
    let bitmap: ImageBitmap;
    let objectUrl: string | null = null;
    
    try {
      // For HEIC files or files without proper MIME type, use Image element directly
      // Safari on iPad may not support createImageBitmap for HEIC
      if (isHeic || !fileType || fileType === 'unknown' || fileType === 'application/octet-stream') {
        console.log('Using Image element fallback for:', file.name);
        objectUrl = URL.createObjectURL(file);
        
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error(`Image load timeout after 10 seconds: ${file.name}`));
          }, 10000);
          
          img.onload = () => {
            clearTimeout(timeout);
            resolve();
          };
          img.onerror = (err) => {
            clearTimeout(timeout);
            const isHeicFile = fileName.endsWith('.heic') || fileName.endsWith('.heif') || fileType.includes('heic') || fileType.includes('heif');
            if (isHeicFile) {
              reject(new Error(`HEIC format not supported: ${file.name}. Safari on iPad cannot decode HEIC files. Please convert to JPEG: Open Photos app → Select photo → Tap Share → Choose "Save Image" or use a converter app.`));
            } else {
              reject(new Error(`Failed to load image: ${file.name}. The file may be corrupted or in an unsupported format.`));
            }
          };
          img.src = objectUrl!;
        });
        
        // Verify image actually loaded (check dimensions)
        if (img.naturalWidth === 0 || img.naturalHeight === 0) {
          // Try FileReader fallback for Safari when Image element fails
          console.warn('Image element failed to load, trying FileReader fallback for:', file.name);
          try {
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                if (reader.result && typeof reader.result === 'string') {
                  resolve(reader.result);
                } else {
                  reject(new Error('FileReader returned invalid result'));
                }
              };
              reader.onerror = () => reject(new Error('FileReader failed to read file'));
              reader.readAsDataURL(file);
            });
            
            const img2 = new Image();
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error(`Image load from data URL timeout: ${file.name}`));
              }, 10000);
              
              img2.onload = () => {
                clearTimeout(timeout);
                resolve();
              };
              img2.onerror = () => {
                clearTimeout(timeout);
                reject(new Error(`Failed to load image from data URL: ${file.name}`));
              };
              img2.src = dataUrl;
            });
            
            if (img2.naturalWidth === 0 || img2.naturalHeight === 0) {
              throw new Error(`Image failed to load even with FileReader: ${file.name}`);
            }
            
            // Use the FileReader-loaded image
            try {
              bitmap = await createImageBitmap(img2);
            } catch (e) {
              // If createImageBitmap fails, try drawing to canvas directly
              console.warn('createImageBitmap failed on FileReader image, using canvas directly:', e);
              const canvas = document.createElement('canvas');
              canvas.width = img2.naturalWidth;
              canvas.height = img2.naturalHeight;
              const ctx = canvas.getContext('2d');
              if (!ctx) {
                throw new Error('Could not create canvas context');
              }
              ctx.drawImage(img2, 0, 0);
              bitmap = await createImageBitmap(canvas);
            }
          } catch (fileReaderError) {
            throw new Error(`Image failed to load: ${file.name}. Tried both Image element and FileReader. The file may be corrupted or in an unsupported format. Error: ${(fileReaderError as Error).message}`);
          }
        } else {
          // Image loaded successfully, create bitmap
          try {
            bitmap = await createImageBitmap(img);
          } catch (e) {
            // If createImageBitmap fails, try drawing to canvas directly
            console.warn('createImageBitmap failed, using canvas directly:', e);
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              throw new Error('Could not create canvas context');
            }
            ctx.drawImage(img, 0, 0);
            bitmap = await createImageBitmap(canvas);
          }
        }
      } else {
        // Try createImageBitmap first (works for most formats)
        try {
          bitmap = await createImageBitmap(file);
        } catch (e) {
          // Fallback: use Image element for formats that createImageBitmap doesn't support
          console.warn('createImageBitmap failed, trying Image fallback for:', file.name, e);
          objectUrl = URL.createObjectURL(file);
          
          const img = new Image();
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error(`Image load timeout after 10 seconds: ${file.name}`));
            }, 10000);
            
            img.onload = () => {
              clearTimeout(timeout);
              resolve();
            };
            img.onerror = () => {
              clearTimeout(timeout);
              const fileName = file.name.toLowerCase();
              const fileType = file.type || 'unknown';
              const isHeicFile = fileName.endsWith('.heic') || fileName.endsWith('.heif') || fileType.includes('heic') || fileType.includes('heif');
              if (isHeicFile) {
                reject(new Error(`HEIC format not supported: ${file.name}. Safari on iPad cannot decode HEIC files. Please convert to JPEG first.`));
              } else {
                reject(new Error(`Failed to load image: ${file.name}. The file may be corrupted or in an unsupported format.`));
              }
            };
            img.src = objectUrl!;
          });
          
          // Verify image actually loaded
          if (img.naturalWidth === 0 || img.naturalHeight === 0) {
            // Try FileReader fallback for Safari when Image element fails
            console.warn('Image element failed to load, trying FileReader fallback for:', file.name);
            try {
              const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                  if (reader.result && typeof reader.result === 'string') {
                    resolve(reader.result);
                  } else {
                    reject(new Error('FileReader returned invalid result'));
                  }
                };
                reader.onerror = () => reject(new Error('FileReader failed to read file'));
                reader.readAsDataURL(file);
              });
              
              const img2 = new Image();
              await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                  reject(new Error(`Image load from data URL timeout: ${file.name}`));
                }, 10000);
                
                img2.onload = () => {
                  clearTimeout(timeout);
                  resolve();
                };
                img2.onerror = () => {
                  clearTimeout(timeout);
                  reject(new Error(`Failed to load image from data URL: ${file.name}`));
                };
                img2.src = dataUrl;
              });
              
              if (img2.naturalWidth === 0 || img2.naturalHeight === 0) {
                throw new Error(`Image failed to load even with FileReader: ${file.name}`);
              }
              
              // Use the FileReader-loaded image
              bitmap = await createImageBitmap(img2);
            } catch (fileReaderError) {
              throw new Error(`Image failed to load: ${file.name}. Tried both Image element and FileReader. The file may be corrupted or in an unsupported format. Error: ${(fileReaderError as Error).message}`);
            }
          } else {
            // Image loaded successfully, create bitmap
            bitmap = await createImageBitmap(img);
          }
        }
      }
    } catch (e) {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      const errorMsg = (e as Error).message || 'Unknown error';
      const helpfulMsg = isHeic 
        ? `HEIC format detected. Safari on iPad may not support HEIC. Try: 1) Convert photo to JPEG in Photos app, or 2) Use a different browser. Error: ${errorMsg}`
        : `Unsupported image format: ${file.name}. ${errorMsg}`;
      throw new Error(helpfulMsg);
    } finally {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    }

    const srcW = bitmap.width;
    const srcH = bitmap.height;
    const scale = Math.min(1, maxDimension / Math.max(srcW, srcH));
    const targetW = Math.max(1, Math.round(srcW * scale));
    const targetH = Math.max(1, Math.round(srcH * scale));

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

    // Try WebP first, fallback to JPEG for Safari/iPad compatibility
    // Safari on iPad may not support WebP encoding via canvas.toBlob
    let blob: Blob | null = null;
    
    // Try WebP encoding
    blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (b) => resolve(b || null),
        'image/webp',
        quality
      );
    });

    // If WebP failed (returns null), fallback to JPEG
    if (!blob) {
      console.warn('WebP encoding not supported, falling back to JPEG');
      blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(
          (b) => resolve(b || null),
          'image/jpeg',
          quality
        );
      });
    }

    if (!blob) {
      throw new Error('Failed to compress image - both WebP and JPEG encoding failed');
    }

    return { blob, width: targetW, height: targetH };
  };

  const uploadAttachmentsToNote = async (
    noteId: string,
    files: File[],
    options?: { throwOnAnyFailure?: boolean }
  ) => {
    if (!files.length) {
      return { successful: 0, failed: [] as Array<{ file: File; error: string }> };
    }

    setUploadingNoteId(noteId);
    try {
      const result = await uploadNoteAttachments({
        jobNumber,
        listNumberContext: normalizedListContext,
        noteId,
        files,
        throwOnAnyFailure: options?.throwOnAnyFailure,
        onError: setError,
      });
      if (result.successful > 0) {
        await loadData();
      }
      return result;
    } finally {
      setUploadingNoteId(null);
    }

    try {
      setUploadingNoteId(noteId);
      setError(null);

      const results: Array<{ file: File; success: boolean; error?: string }> = [];

      // Log browser and device info for debugging
      console.log('Upload environment:', {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        origin: window.location.origin,
        fileCount: files.length,
      });

      for (const file of files) {
        let uploadPhase: 'upload-url' | 'r2-put' | 'metadata' = 'upload-url';
        try {
          const isImage = file.type.startsWith('image/');

          console.log(`[Upload] Starting processing for ${file.name}`, {
            size: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
            type: file.type || 'unknown',
            lastModified: new Date(file.lastModified).toISOString(),
          });
          
          let blob: Blob;
          let width: number | null;
          let height: number | null;
          const fileName = file.name?.trim() || null;
          
          if (isImage) {
            try {
              console.log(`[Compress] Starting compression for ${file.name}`);
              const result = await compressImageToWebP(file, {
                maxDimension: 1800,
                quality: 0.82,
              });
              blob = result.blob;
              width = result.width;
              height = result.height;
              console.log(`[Compress] Successfully compressed ${file.name}`, {
                originalSize: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
                compressedSize: `${(blob.size / 1024 / 1024).toFixed(2)} MB`,
                compressionRatio: `${((1 - blob.size / file.size) * 100).toFixed(1)}%`,
                dimensions: `${width}x${height}`,
                blobType: blob.type,
              });
            } catch (compressError) {
              const errorMsg = (compressError as Error).message || 'Unknown compression error';
              console.error(`[Compress] Compression failed for ${file.name}:`, {
                error: errorMsg,
                stack: (compressError as Error).stack,
                file: {
                  name: file.name,
                  size: file.size,
                  type: file.type,
                },
              });
              throw new Error(`Failed to process image: ${errorMsg}`);
            }

            console.log(`Compressed ${file.name} to ${(blob.size / 1024 / 1024).toFixed(2)} MB (${blob.type})`);
            
            // Ensure we have a valid blob type for images
            if (!blob.type || blob.type === 'unknown') {
              console.warn(`Blob type is ${blob.type}, defaulting to image/jpeg`);
              const canvas = document.createElement('canvas');
              const img = new Image();
              const imgUrl = URL.createObjectURL(blob);
              await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error('Failed to reload compressed image'));
                img.src = imgUrl;
              });
              canvas.width = img.naturalWidth;
              canvas.height = img.naturalHeight;
              const ctx = canvas.getContext('2d')!;
              ctx.drawImage(img, 0, 0);
              blob = await new Promise<Blob>((resolve) => {
                canvas.toBlob((b) => resolve(b || blob), 'image/jpeg', 0.82);
              });
              URL.revokeObjectURL(imgUrl);
            }
          } else {
            blob = file;
            width = null;
            height = null;
            console.log(`[Upload] Non-image file, no compression: ${file.name}`);
          }

          const effectiveContentType = blob.type || file.type || 'application/octet-stream';

          console.log(`Requesting upload URL for ${file.name}...`);
          const uploadUrlRes = await fetch(
            withListContext(
              `/api/jobs/${encodeURIComponent(jobNumber)}/notes/${encodeURIComponent(noteId)}/attachments/upload-url`
            ),
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include', // Ensure cookies are sent for network access
              body: JSON.stringify({ contentType: effectiveContentType }),
            }
          );

          if (!uploadUrlRes.ok) {
            let errData: any = {};
            try {
              errData = await uploadUrlRes.json();
            } catch {
              errData = { error: `HTTP ${uploadUrlRes.status}: ${uploadUrlRes.statusText}` };
            }
            console.error(`[Upload URL] Failed to get upload URL for ${file.name}:`, {
              status: uploadUrlRes.status,
              statusText: uploadUrlRes.statusText,
              error: errData,
              url: uploadUrlRes.url,
            });
            throw new Error(errData.error || `Failed to create upload URL for ${file.name} (${uploadUrlRes.status})`);
          }

          const { r2Key, putUrl } = await uploadUrlRes.json();
          console.log(`[Upload URL] Received presigned URL for ${file.name}`, {
            r2Key,
            putUrlLength: putUrl.length,
            putUrlPreview: putUrl.substring(0, 100),
          });

          uploadPhase = 'r2-put';
          console.log(`Uploading ${file.name} to R2...`);
          console.log(`Upload URL: ${putUrl.substring(0, 100)}...`);
          console.log(`Blob size: ${blob.size} bytes, type: ${blob.type}`);
          
          const putRes = await fetch(putUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': effectiveContentType,
            },
            body: blob,
          });

          if (!putRes.ok) {
            // Try to get error details
            let errorText = putRes.statusText || 'Unknown error';
            try {
              const errorBody = await putRes.text();
              if (errorBody) errorText = errorBody;
            } catch {}
            
            console.error(`R2 upload failed:`, {
              status: putRes.status,
              statusText: putRes.statusText,
              errorText,
              url: putUrl.substring(0, 100),
              origin: window.location.origin,
            });
            
            // Detect CORS errors
            if (putRes.status === 0 || putRes.status === 403 || (putRes.status === 0 && !putRes.ok)) {
              const currentOrigin = window.location.origin;
              throw new Error(`❌ CORS Error: Upload Blocked\n\nYour R2 bucket CORS configuration must allow:\n${currentOrigin}\n\nTo fix:\n1. Go to Cloudflare Dashboard → R2 → Your Bucket\n2. Open CORS settings\n3. Add ${currentOrigin} to allowed origins\n4. Allow methods: PUT, GET, HEAD\n5. Allow headers: content-type\n\nSee R2_SETUP.md for detailed instructions.`);
            }
            
            throw new Error(`Upload to storage failed: ${errorText} (${putRes.status})`);
          }

          uploadPhase = 'metadata';
          console.log(`Saving metadata for ${file.name}...`);
          const metaPayload: Record<string, unknown> = {
            r2Key,
            contentType: effectiveContentType,
            sizeBytes: blob.size,
            width: width ?? undefined,
            height: height ?? undefined,
          };
          if (fileName) metaPayload.fileName = fileName;
          const metaRes = await fetch(
            withListContext(
              `/api/jobs/${encodeURIComponent(jobNumber)}/notes/${encodeURIComponent(noteId)}/attachments`
            ),
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include', // Ensure cookies are sent for network access
              body: JSON.stringify(metaPayload),
            }
          );

          if (!metaRes.ok) {
            let errData: any = {};
            try {
              errData = await metaRes.json();
            } catch {
              errData = { error: `HTTP ${metaRes.status}: ${metaRes.statusText}` };
            }
            console.error(`[Metadata] Failed to save metadata for ${file.name}:`, {
              status: metaRes.status,
              statusText: metaRes.statusText,
              error: errData,
            });
            throw new Error(errData.error || `Failed to save metadata for ${file.name} (${metaRes.status})`);
          }

          console.log(`[Upload] Successfully uploaded ${file.name}`, {
            r2Key,
            size: blob.size,
            dimensions: width != null && height != null ? `${width}x${height}` : 'N/A',
          });
          results.push({ file, success: true });
        } catch (fileError) {
          let errorMessage = (fileError as Error).message || `Failed to upload ${file.name}`;
          
          // Provide helpful error messages for common issues
          const fileName = file.name.toLowerCase();
          const isHeic = fileName.endsWith('.heic') || fileName.endsWith('.heif') || 
                         file.type?.includes('heic') || file.type?.includes('heif');
          
          // Log comprehensive error details
          console.error(`[Upload] Error uploading ${file.name}:`, {
            error: errorMessage,
            stack: (fileError as Error).stack,
            file: {
              name: file.name,
              size: file.size,
              type: file.type,
              isHeic,
            },
            timestamp: new Date().toISOString(),
          });
          
          // Provide helpful error messages for common issues
          if (errorMessage.includes('CORS') || errorMessage.includes('CORS Error')) {
            // CORS error already has detailed message, keep it
          } else if (errorMessage.includes('HEIC') || errorMessage.includes('heic') || errorMessage.includes('Failed to load image')) {
            if (isHeic) {
              errorMessage = `❌ HEIC Format Not Supported\n\nSafari on iPad cannot decode HEIC photos.\n\nTo fix:\n1. Open Photos app on iPad\n2. Select the photo\n3. Tap Share button\n4. Choose "Save Image" (converts to JPEG)\n5. Or use a converter app\n\nThen try uploading the JPEG version.`;
            } else {
              errorMessage = `❌ Image Load Failed: ${file.name}\n\nThe image could not be loaded. Possible causes:\n• File is corrupted\n• Format not supported by Safari\n• HEIC format (convert to JPEG first)\n\nTry converting the photo to JPEG and upload again.`;
            }
          } else if (errorMessage.includes('Unsupported image format')) {
            errorMessage = `❌ Unsupported Format: ${file.name}\n\nPlease use JPEG, PNG, or WebP images.\n\nTo convert HEIC to JPEG:\n1. Open Photos app\n2. Select photo → Share → Save Image`;
          } else if (errorMessage.includes('timeout')) {
            errorMessage = `❌ Upload Timeout: ${file.name}\n\nThe image took too long to process.\n\nTry:\n• Using a smaller image\n• Converting HEIC to JPEG first\n• Checking your network connection`;
          } else if (errorMessage.includes('network') || errorMessage.includes('Network') || errorMessage.includes('fetch') || errorMessage.includes('Failed to fetch')) {
            if (uploadPhase === 'upload-url') {
              errorMessage = `❌ Network Error: ${file.name}\n\nCould not reach the app server (requesting upload link).\n\nTry:\n• Check your network connection\n• If using a custom URL or another device, ensure the app is reachable at that URL\n• Refresh the page and try again`;
            } else if (uploadPhase === 'r2-put') {
              errorMessage = `❌ Network Error: ${file.name}\n\nCould not upload to file storage (Cloudflare R2).\n\nCommon causes:\n• R2 CORS: Your current site URL must be allowed in the R2 bucket CORS settings (e.g. add ${typeof window !== 'undefined' ? window.location.origin : 'your site URL'})\n• Firewall or network blocking *.r2.cloudflarestorage.com\n\nSee R2_SETUP.md for CORS and env setup. Then refresh and try again.`;
            } else {
              errorMessage = `❌ Network Error: ${file.name}\n\nCould not save file record (metadata step).\n\nTry:\n• Check your network connection\n• Refresh the page and try again`;
            }
          }
          
          results.push({ file, success: false, error: errorMessage });
        }
      }

      // Show summary of results
      const successful = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success);

      if (failed.length > 0) {
        const errorMessages = failed.map((r) => r.error || `Failed: ${r.file.name}`).join('\n');
        const errorText = successful > 0 
          ? `Uploaded ${successful} of ${files.length} file(s).\n\nErrors:\n${errorMessages}`
          : `Failed to upload ${files.length} file(s).\n\nErrors:\n${errorMessages}`;
        setError(errorText);
        if (options?.throwOnAnyFailure) {
          throw new Error(errorText);
        }
      } else if (successful > 0) {
        // Clear any previous errors on success
        setError(null);
      }

      // Reload data to show uploaded photos
      if (successful > 0) {
        await loadData();
      }
      return {
        successful,
        failed: failed.map((f) => ({ file: f.file, error: f.error || `Failed: ${f.file.name}` })),
      };
    } catch (err) {
      console.error('Error in uploadAttachmentsToNote:', err);
      const message = (err as Error).message || 'Failed to upload attachments';
      setError(message);
      if (options?.throwOnAnyFailure) {
        throw err;
      }
      return {
        successful: 0,
        failed: files.map((file) => ({ file, error: message })),
      };
    } finally {
      setUploadingNoteId(null);
    }
  };

  const openCameraFor = (noteId: string | null) => {
    setCameraTargetNoteId(noteId);
    setIsCameraOpen(true);
  };

  const addFilesToNewNote = (files: File[]) => {
    if (!files.length) return;
    setNewNoteFiles((prev) => [...prev, ...files]);
  };

  const confirmCameraPhotos = async () => {
    if (cameraFiles.length === 0) {
      setIsCameraOpen(false);
      return;
    }

    try {
      if (cameraTargetNoteId) {
        await uploadAttachmentsToNote(cameraTargetNoteId, cameraFiles);
      } else {
        addFilesToNewNote(cameraFiles);
      }
      // Clear camera files after successful handling
      setCameraFiles([]);
    } catch (err) {
      console.error('Error confirming camera photos:', err);
      setError((err as Error).message || 'Failed to process camera photos');
    } finally {
      setIsCameraOpen(false);
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteContent.trim() && newNoteFiles.length === 0) return;
    let createdNoteId: string | null = null;

    try {
      setIsSaving(true);
      setError(null);

      const hadFiles = newNoteFiles.length > 0;

      const response = await fetch(
        withListContext(`/api/jobs/${encodeURIComponent(jobNumber)}/notes`),
        {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: newNoteContent.trim(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to add note');
      }

      const data = await response.json();
      const createdNote: JobNote = data.note;
      createdNoteId = createdNote.id;
      if (hadFiles) {
        await uploadAttachmentsToNote(createdNote.id, newNoteFiles, {
          throwOnAnyFailure: true,
        });
      }

      setNewNoteContent('');
      setNewNoteFiles([]);
      setIsNewNoteDragActive(false);
      setShowAddNoteModal(false);
      await loadData();
    } catch (err) {
      console.error('Error adding note:', err);
      if (createdNoteId) {
        try {
          await fetch(
            withListContext(
              `/api/jobs/${encodeURIComponent(jobNumber)}/notes?id=${encodeURIComponent(createdNoteId)}`
            ),
            { method: 'DELETE' }
          );
        } catch (rollbackErr) {
          console.error('Failed to rollback note after attachment upload error:', rollbackErr);
        }
        await loadData();
      }
      setError((err as Error).message || 'Failed to add note');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmitReply = async (rootId: string) => {
    if (!replyContent.trim()) return;
    try {
      setIsSaving(true);
      setError(null);
      const response = await fetch(
        withListContext(`/api/jobs/${encodeURIComponent(jobNumber)}/notes`),
        {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: replyContent.trim(), parentId: rootId }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to add reply');
      }
      const replyData = await response.json();
      const createdReply: JobNote = replyData.note;

      await loadData();
      setReplyingToRootId(null);
      setReplyContent('');
    } catch (err) {
      console.error('Error adding reply:', err);
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditNote = (note: JobNote) => {
    setEditingNoteId(note.id);
    setEditNoteContent(note.content);
    setOriginalNoteContent(note.content);
  };

  const handleCancelEdit = () => {
    setEditingNoteId(null);
    setEditNoteContent('');
    setOriginalNoteContent('');
    setShowEditConfirm(false);
  };

  const handleSaveClick = (noteId: string) => {
    // Check if content has changed
    if (editNoteContent.trim() !== originalNoteContent.trim()) {
      setShowEditConfirm(true);
    } else {
      // No changes, just cancel
      handleCancelEdit();
    }
  };

  const handleConfirmSaveEdit = async () => {
    if (!editingNoteId || !editNoteContent.trim()) {
      setError('Note content cannot be empty');
      setShowEditConfirm(false);
      return;
    }

    try {
      setIsEditing(true);
      setError(null);

      const response = await fetch(
        withListContext(`/api/jobs/${encodeURIComponent(jobNumber)}/notes?id=${encodeURIComponent(editingNoteId)}`),
        {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editNoteContent.trim() }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update note');
      }

      await loadData();
      setEditingNoteId(null);
      setEditNoteContent('');
      setOriginalNoteContent('');
      setShowEditConfirm(false);
    } catch (err) {
      console.error('Error updating note:', err);
      setError((err as Error).message);
      setShowEditConfirm(false);
    } finally {
      setIsEditing(false);
    }
  };

  const handleDeleteClick = (note: JobNote) => {
    setDeletingNoteId(note.id);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingNoteId) return;

    try {
      setIsSaving(true);
      setError(null);

      const response = await fetch(
        withListContext(`/api/jobs/${encodeURIComponent(jobNumber)}/notes?id=${encodeURIComponent(deletingNoteId)}`),
        {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete note');
      }

      await loadData();
      setShowDeleteConfirm(false);
      setDeletingNoteId(null);
    } catch (err) {
      console.error('Error deleting note:', err);
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const canEditNote = (note: JobNote): boolean => {
    return canAddEditNotes && isNoteAuthor(note);
  };

  const canDeleteNote = (note: JobNote): boolean => {
    return canDeleteNotes && isNoteAuthor(note);
  };

  const handleDeleteAttachment = async (noteId: string, attachmentId: string) => {
    try {
      setIsSaving(true);
      setError(null);

      const res = await fetch(
        withListContext(
          `/api/jobs/${encodeURIComponent(jobNumber)}/notes/${encodeURIComponent(noteId)}/attachments?id=${encodeURIComponent(attachmentId)}`
        ),
        { method: 'DELETE' }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to delete attachment');
      }

      await loadData();
    } catch (err) {
      console.error('Error deleting attachment:', err);
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const formatDate = (dateString: string) => {
    return formatDateInAppTimeZone(dateString, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 rounded-xl p-12 text-center backdrop-blur-sm shadow-xl">
        <div className="flex justify-center items-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        </div>
        <p className="text-slate-300 font-medium mt-4">Loading notes...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden min-h-0">
      {/* Error Banner */}
      {error && (
        <div className="flex-shrink-0 bg-red-500 border border-red-600 rounded-xl p-4 flex items-start space-x-3 shadow-lg shadow-red-500/20 backdrop-blur-sm mb-6">
          <svg
            className="w-6 h-6 text-white flex-shrink-0 animate-pulse"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clipRule="evenodd"
            />
          </svg>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-white">Error</h3>
            <p className="text-sm text-white/90 dark:text-white/90 mt-1 whitespace-pre-line">{error}</p>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-white hover:text-white/80 transition-all transform hover:scale-110"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      )}

      {notificationWarning && (
        <div className="flex-shrink-0 bg-yellow-500 border border-yellow-600 rounded-xl p-3 flex items-start space-x-3 shadow-lg shadow-yellow-500/20 backdrop-blur-sm mb-4">
          <svg className="w-5 h-5 text-white flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <p className="flex-1 text-sm text-white font-medium">{notificationWarning}</p>
          <button
            onClick={() => setNotificationWarning(null)}
            className="text-white hover:text-white/80 transition-all"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      )}

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Notes Section */}
        <div className="flex flex-col min-h-0 overflow-hidden">
          <div className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 rounded-xl p-6 backdrop-blur-sm shadow-xl h-full flex flex-col min-h-0">
            <div className="flex items-center justify-between gap-4 mb-4 flex-shrink-0">
              {/* Toggle: Notes / Packing Slips */}
              <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setActiveView('notes')}
                  className={`px-4 py-2 text-sm font-semibold transition-colors ${
                    activeView === 'notes'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700'
                  }`}
                >
                  Notes
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView('packing-slips')}
                  className={`px-4 py-2 text-sm font-semibold transition-colors ${
                    activeView === 'packing-slips'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700'
                  }`}
                >
                  Packing Slips
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView('import-history')}
                  className={`px-4 py-2 text-sm font-semibold transition-colors ${
                    activeView === 'import-history'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700'
                  }`}
                >
                  Import History
                </button>
              </div>
              {/* Action button — context-dependent */}
              {activeView === 'notes' && canAddEditNotes && (
                <button
                  type="button"
                  onClick={() => setShowAddNoteModal(true)}
                  className="px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl font-semibold hover:from-blue-600 hover:to-blue-700 transition-all shadow-lg shadow-blue-500/30"
                >
                  Add note
                </button>
              )}
              {activeView === 'packing-slips' && canUploadPackingSlips && (
                <label className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl cursor-pointer shadow-lg shadow-blue-500/30 transition-all">
                  <span>+ Upload</span>
                  <input type="file" multiple className="hidden" onChange={handlePackingSlipUpload} />
                </label>
              )}
              {activeView === 'import-history' && (
                <button
                  type="button"
                  onClick={() => loadImportHistory()}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded-xl font-semibold transition-all shadow-lg shadow-slate-900/20"
                >
                  Refresh
                </button>
              )}
            </div>

            {/* Packing Slips View */}
            {activeView === 'packing-slips' && (
              <div className="flex-1 overflow-y-auto min-h-0">
                {packingSlipError && (
                  <p className="text-red-500 text-sm mb-3">{packingSlipError}</p>
                )}
                {isLoadingPackingSlips ? (
                  <p className="text-slate-600 dark:text-slate-400 text-sm">Loading packing slips…</p>
                ) : packingSlips.length === 0 ? (
                  <p className="text-slate-600 dark:text-slate-400 text-sm">No packing slips uploaded yet.</p>
                ) : (
                  <div className="space-y-2">
                    {packingSlips.map((att) => (
                      <div key={att.id} className="flex items-center justify-between gap-2 border border-gray-200 dark:border-slate-700/60 rounded-lg px-3 py-2 bg-gray-50 dark:bg-slate-800">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-sm text-slate-900 dark:text-white">{att.fileName}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {att.uploadedBy} · {new Date(att.uploadedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <a href={att.url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">View</a>
                          {canUploadPackingSlips && (
                            <button type="button" onClick={() => handlePackingSlipDelete(att.id)} className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm">Delete</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeView === 'import-history' && (
              <div className="flex-1 overflow-y-auto min-h-0">
                {importHistoryError && (
                  <p className="mb-3 text-sm text-red-500">{importHistoryError}</p>
                )}
                {isLoadingImportHistory ? (
                  <p className="text-sm text-slate-600 dark:text-slate-400">Loading PDF import history…</p>
                ) : importHistory.length === 0 ? (
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    No imports have been saved for this job yet.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {importHistory.map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-slate-700/60 dark:bg-slate-800"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                              {entry.sourceFileName}
                            </div>
                            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              {entry.status} · {entry.createdBy} · {new Date(entry.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                            </div>
                            {entry.committedAt && (
                              <div className="mt-1 text-xs text-emerald-600 dark:text-emerald-300">
                                Committed {new Date(entry.committedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-sm">
                            <a
                              href={withListContext(
                                `/api/jobs/${encodeURIComponent(jobNumber)}/pdf-update-imports/${encodeURIComponent(entry.id)}/source`,
                              )}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline dark:text-blue-400"
                            >
                              View Source File
                            </a>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Notes List */}
            {activeView === 'notes' && (
              <div
                ref={notesListScrollRef}
                className="flex-1 overflow-y-auto min-h-0 space-y-4 pr-2"
              >
              {notes.length === 0 ? (
                <div className="text-center py-8 text-slate-600 dark:text-slate-400">
                  <svg
                    className="w-12 h-12 mx-auto mb-3 text-slate-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <p>No notes yet. Click Add note to create one.</p>
                </div>
              ) : (
                rootNotes.map((root) => {
                  const replies = repliesByRootId.get(root.id) || [];
                  const rootId = root.id;
                  const isHighlighted = highlightedNoteId === root.id;
                  return (
                    <div key={root.id} className="space-y-3">
                      {/* Root note card */}
                      <div
                        id={`note-${root.id}`}
                        className={`bg-gray-50 dark:bg-slate-700/50 border border-gray-200 dark:border-slate-600/50 rounded-xl p-4 shadow-sm hover:shadow-md hover:bg-gray-100 dark:hover:bg-slate-700/70 transition-all ${
                          isHighlighted
                            ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-800 animate-pulse'
                            : ''
                        }`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-slate-900 dark:text-white">{root.createdBy || 'Unknown'}</p>
                            <p className="text-xs text-slate-600 dark:text-slate-400">{formatDate(root.createdAt)}</p>
                            {root.updatedAt !== root.createdAt && (
                              <p className="text-xs text-slate-500 dark:text-slate-500 mt-0.5">(Edited {formatDate(root.updatedAt)})</p>
                            )}
                          </div>
                          {(canEditNote(root) || canDeleteNote(root)) && (
                        <div className="flex items-center gap-2 ml-4">
                          {editingNoteId === root.id ? (
                            <>
                              <button
                                onClick={() => handleSaveClick(root.id)}
                                disabled={isEditing || !editNoteContent.trim()}
                                className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                              >
                                {isEditing ? 'Saving...' : 'Save'}
                              </button>
                              <button
                                onClick={handleCancelEdit}
                                disabled={isEditing}
                                className="px-3 py-1.5 bg-gray-400 dark:bg-slate-600 hover:bg-gray-500 dark:hover:bg-slate-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              {canEditNote(root) && (
                              <button
                                onClick={() => handleEditNote(root)}
                                disabled={isEditing || isSaving}
                                className="p-2 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/20 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Edit note"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                              )}
                              {canDeleteNote(root) && (
                              <button
                                onClick={() => handleDeleteClick(root)}
                                disabled={isEditing || isSaving}
                                className="p-2 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/20 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Delete note"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                        </div>
                        {root.noteKind === JOB_NOTE_KIND_DELIVERY_DATE_CHANGE && (
                          <p className="mt-2 text-xs font-medium text-amber-800 dark:text-amber-200/90 bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/50 rounded-lg px-2.5 py-1.5 inline-block">
                            {formatDeliveryDateChangeBadge(
                              root.deliveryDateFrom,
                              root.deliveryDateTo,
                            )}
                          </p>
                        )}
                        {editingNoteId === root.id ? (
                          <textarea
                            value={editNoteContent}
                            onChange={(e) => setEditNoteContent(e.target.value)}
                            rows={4}
                            className="w-full px-4 py-3 bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-600/50 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-500 shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium resize-none mt-2"
                            placeholder="Edit your note..."
                          />
                        ) : (
                          root.content?.trim() ? (
                            <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap mt-2">{root.content}</p>
                          ) : root.attachments && root.attachments.length > 0 ? (
                            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-2">Attachment-only note</p>
                          ) : null
                        )}

                        {/* Attachments */}
                        {root.attachments && root.attachments.length > 0 && (
                          <div className="mt-4">
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                              {root.attachments.map((a) =>
                                a.contentType.startsWith('image/') ? (
                                  <div key={a.id} className="relative group">
                                    <a href={a.url} target="_blank" rel="noreferrer">
                                      <img
                                        src={a.url}
                                        alt="Note attachment"
                                        className="w-full h-28 object-cover rounded-xl border border-gray-300 dark:border-slate-600/50 hover:border-gray-400 dark:hover:border-slate-500/80 transition-all"
                                        loading="lazy"
                                      />
                                    </a>
                                    {canEditNote(root) && (
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteAttachment(root.id, a.id)}
                                        disabled={isSaving || isEditing}
                                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-all px-2 py-1 rounded-lg text-xs font-semibold bg-red-600/90 hover:bg-red-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                        title="Delete attachment"
                                      >
                                        Delete
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <div key={a.id} className="relative group flex flex-col p-3 rounded-xl border border-gray-300 dark:border-slate-600/50 bg-gray-50 dark:bg-slate-700/30 hover:border-gray-400 dark:hover:border-slate-500/80 transition-all min-h-[7rem]">
                                    <div className="flex items-center gap-2 mb-2">
                                      <svg className="w-8 h-8 text-red-600 dark:text-red-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                                      </svg>
                                      <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate flex-1">
                                        {a.fileName || 'PDF'}
                                      </span>
                                    </div>
                                    <a href={a.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline mt-auto">
                                      Open PDF
                                    </a>
                                    {canEditNote(root) && (
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteAttachment(root.id, a.id)}
                                        disabled={isSaving || isEditing}
                                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-all px-2 py-1 rounded-lg text-xs font-semibold bg-red-600/90 hover:bg-red-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                        title="Delete attachment"
                                      >
                                        Delete
                                      </button>
                                    )}
                                  </div>
                                )
                              )}
                            </div>
                          </div>
                        )}

                        {/* Add photos + Reply (same row, Reply on the right) */}
                        {canAddEditNotes && (
                          <div className="mt-4 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-4">
                              {canEditNote(root) && (
                                <>
                                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-all cursor-pointer">
                                    Add photos or PDFs
                                    <input
                                      type="file"
                                      multiple
                                      disabled={isSaving || isEditing || uploadingNoteId === root.id}
                                      onChange={async (e) => {
                                        const files = Array.from(e.target.files || []);
                                        e.currentTarget.value = '';
                                        if (files.length === 0) return;
                                        try {
                                          await uploadAttachmentsToNote(root.id, files);
                                        } catch (err) {
                                          console.error('Error uploading attachments:', err);
                                          setError((err as Error).message || 'Failed to upload attachments');
                                        }
                                      }}
                                      className="sr-only"
                                    />
                                  </label>
                                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-all cursor-pointer">
                                    <button
                                      type="button"
                                      onClick={() => openCameraFor(root.id)}
                                      disabled={isSaving || isEditing || uploadingNoteId === root.id}
                                      className="text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      Use camera
                                    </button>
                                  </label>
                                </>
                              )}
                              {canEditNote(root) && uploadingNoteId === root.id && (
                                <span className="text-xs text-slate-600 dark:text-slate-400">Uploading...</span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => setReplyingToRootId(rootId)}
                              disabled={isSaving}
                              className="ml-auto text-sm font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                            >
                              Reply
                            </button>
                          </div>
                        )}

                        {/* Inline reply form (inside card) */}
                        {canAddEditNotes && replyingToRootId === rootId && (
                          <div className="mt-3 pt-3 border-t border-gray-200 dark:border-slate-600/50 space-y-2">
                            <textarea
                              value={replyContent}
                              onChange={(e) => setReplyContent(e.target.value)}
                              rows={3}
                              placeholder="Write a reply..."
                              className="w-full px-3 py-2 bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-600/50 rounded-lg text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-500 text-sm"
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => handleSubmitReply(rootId)}
                                disabled={isSaving || !replyContent.trim()}
                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {isSaving ? 'Sending...' : 'Send reply'}
                              </button>
                              <button
                                type="button"
                                onClick={() => { setReplyingToRootId(null); setReplyContent(''); }}
                                disabled={isSaving}
                                className="px-3 py-1.5 bg-gray-200 dark:bg-slate-600 hover:bg-gray-300 dark:hover:bg-slate-500 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-semibold disabled:opacity-50"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Replies (thread) */}
                      {replies.length > 0 && (
                        <div className="ml-4 space-y-2 border-l-2 border-slate-300 dark:border-slate-600 pl-4">
                          {replies.map((reply) => (
                            <div
                              key={reply.id}
                              id={`note-${reply.id}`}
                              className={`bg-gray-50/80 dark:bg-slate-700/30 border border-gray-200 dark:border-slate-600/50 rounded-lg p-3 shadow-sm ${
                                highlightedNoteId === reply.id
                                  ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-800 animate-pulse'
                                  : ''
                              }`}
                            >
                              <div className="flex items-start justify-between mb-1">
                                <div className="flex-1">
                                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{reply.createdBy || 'Unknown'}</p>
                                  <p className="text-xs text-slate-600 dark:text-slate-400">{formatDate(reply.createdAt)}</p>
                                  {reply.updatedAt !== reply.createdAt && (
                                    <p className="text-xs text-slate-500 dark:text-slate-500">(Edited {formatDate(reply.updatedAt)})</p>
                                  )}
                                </div>
                                {(canEditNote(reply) || canDeleteNote(reply)) && (
                                  <div className="flex items-center gap-1 ml-2">
                                    {editingNoteId === reply.id ? (
                                      <>
                                        <button
                                          onClick={() => handleSaveClick(reply.id)}
                                          disabled={isEditing || !editNoteContent.trim()}
                                          className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold disabled:opacity-50"
                                        >
                                          Save
                                        </button>
                                        <button
                                          onClick={handleCancelEdit}
                                          disabled={isEditing}
                                          className="px-2 py-1 bg-gray-400 dark:bg-slate-600 text-white rounded text-xs font-semibold"
                                        >
                                          Cancel
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        {canEditNote(reply) && (
                                        <button
                                          onClick={() => handleEditNote(reply)}
                                          disabled={isEditing || isSaving}
                                          className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/20 rounded disabled:opacity-50"
                                          title="Edit"
                                        >
                                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                          </svg>
                                        </button>
                                        )}
                                        {canDeleteNote(reply) && (
                                        <button
                                          onClick={() => handleDeleteClick(reply)}
                                          disabled={isEditing || isSaving}
                                          className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/20 rounded disabled:opacity-50"
                                          title="Delete"
                                        >
                                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                          </svg>
                                        </button>
                                        )}
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                              {editingNoteId === reply.id ? (
                                <textarea
                                  value={editNoteContent}
                                  onChange={(e) => setEditNoteContent(e.target.value)}
                                  rows={3}
                                  className="w-full px-3 py-2 bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-600/50 rounded-lg text-sm text-slate-900 dark:text-white mt-2"
                                  placeholder="Edit your note..."
                                />
                              ) : (
                                reply.content?.trim() ? (
                                  <p className="text-slate-700 dark:text-slate-300 text-sm whitespace-pre-wrap mt-1">{reply.content}</p>
                                ) : reply.attachments && reply.attachments.length > 0 ? (
                                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-1">Attachment-only note</p>
                                ) : null
                              )}
                              {reply.attachments && reply.attachments.length > 0 && (
                                <div className="mt-3 grid grid-cols-2 gap-2">
                                  {reply.attachments.map((a) =>
                                    a.contentType.startsWith('image/') ? (
                                      <div key={a.id} className="relative group">
                                        <a href={a.url} target="_blank" rel="noreferrer">
                                          <img
                                            src={a.url}
                                            alt="Attachment"
                                            className="w-full h-20 object-cover rounded-lg border border-gray-300 dark:border-slate-600/50"
                                            loading="lazy"
                                          />
                                        </a>
                                        {canEditNote(reply) && (
                                          <button
                                            type="button"
                                            onClick={() => handleDeleteAttachment(reply.id, a.id)}
                                            disabled={isSaving || isEditing}
                                            className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-red-600/90 hover:bg-red-600 text-white disabled:opacity-50"
                                          >
                                            Delete
                                          </button>
                                        )}
                                      </div>
                                    ) : (
                                      <div key={a.id} className="relative group flex flex-col p-2 rounded-lg border border-gray-300 dark:border-slate-600/50 bg-gray-50 dark:bg-slate-700/30 min-h-[5rem]">
                                        <div className="flex items-center gap-1.5 mb-1">
                                          <svg className="w-6 h-6 text-red-600 dark:text-red-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                                          </svg>
                                          <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate flex-1">
                                            {a.fileName || 'PDF'}
                                          </span>
                                        </div>
                                        <a href={a.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline mt-auto">
                                          Open PDF
                                        </a>
                                        {canEditNote(reply) && (
                                          <button
                                            type="button"
                                            onClick={() => handleDeleteAttachment(reply.id, a.id)}
                                            disabled={isSaving || isEditing}
                                            className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-red-600/90 hover:bg-red-600 text-white disabled:opacity-50"
                                          >
                                            Delete
                                          </button>
                                        )}
                                      </div>
                                    )
                                  )}
                                </div>
                              )}
                              {canEditNote(reply) && (
                                <div className="mt-2 flex items-center gap-3">
                                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 cursor-pointer">
                                    Add photos or PDFs
                                    <input
                                      type="file"
                                      multiple
                                      disabled={isSaving || isEditing || uploadingNoteId === reply.id}
                                      onChange={async (e) => {
                                        const files = Array.from(e.target.files || []);
                                        e.currentTarget.value = '';
                                        if (files.length === 0) return;
                                        try {
                                          await uploadAttachmentsToNote(reply.id, files);
                                        } catch (err) {
                                          console.error('Error uploading attachments:', err);
                                          setError((err as Error).message || 'Failed to upload attachments');
                                        }
                                      }}
                                      className="sr-only"
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() => openCameraFor(reply.id)}
                                    disabled={isSaving || isEditing || uploadingNoteId === reply.id}
                                    className="text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-50"
                                  >
                                    Use camera
                                  </button>
                                  {canAddEditNotes && (
                                    <button
                                      type="button"
                                      onClick={() => { setReplyingToRootId(rootId); setReplyContent(''); }}
                                      disabled={isSaving}
                                      className="ml-auto text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                                    >
                                      Reply
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            )}
          </div>
        </div>

      </div>

      {/* Add Note Modal */}
      {showAddNoteModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800/90 border border-gray-200 dark:border-slate-700/50 rounded-2xl shadow-2xl max-w-lg w-full p-6 text-slate-900 dark:text-white">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Add note</h2>
              <button
                type="button"
                onClick={() => {
                  setShowAddNoteModal(false);
                  setNewNoteContent('');
                  setNewNoteFiles([]);
                  setIsNewNoteDragActive(false);
                }}
                disabled={isSaving}
                className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700/70 transition-all disabled:opacity-50"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleAddNote} className="space-y-3">
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">Add New Note</label>
              <textarea
                value={newNoteContent}
                onChange={(e) => setNewNoteContent(e.target.value)}
                placeholder="Enter your note or comment..."
                rows={4}
                className="w-full px-4 py-3 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-500 shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium resize-none disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={!canAddEditNotes || isSaving}
              />
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">Add files (optional)</label>
                <div
                  onDragEnter={(e) => {
                    e.preventDefault();
                    if (!canAddEditNotes || isSaving) return;
                    setIsNewNoteDragActive(true);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (!canAddEditNotes || isSaving) return;
                    setIsNewNoteDragActive(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    const related = e.relatedTarget as Node | null;
                    if (!related || !e.currentTarget.contains(related)) {
                      setIsNewNoteDragActive(false);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsNewNoteDragActive(false);
                    if (!canAddEditNotes || isSaving) return;
                    const files = Array.from(e.dataTransfer.files || []);
                    addFilesToNewNote(files);
                  }}
                  className={`rounded-xl border-2 border-dashed p-4 transition-all ${
                    isNewNoteDragActive
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-300 dark:border-slate-600/50 bg-gray-50 dark:bg-slate-700/30'
                  }`}
                >
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Drag and drop files here, or use Upload.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <label className={`w-full sm:w-auto px-4 py-2 bg-gray-100 dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-700 dark:text-slate-200 rounded-xl font-semibold hover:bg-gray-200 dark:hover:bg-slate-700/70 hover:text-slate-900 dark:hover:text-white transition-all ${!canAddEditNotes || isSaving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                    Upload
                    <input
                      type="file"
                      multiple
                      className="sr-only"
                      disabled={!canAddEditNotes || isSaving}
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        e.currentTarget.value = '';
                        if (files.length === 0) return;
                        addFilesToNewNote(files);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => openCameraFor(null)}
                    disabled={!canAddEditNotes || isSaving}
                    className="w-full sm:w-auto px-4 py-2 bg-gray-100 dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-700 dark:text-slate-200 rounded-xl font-semibold hover:bg-gray-200 dark:hover:bg-slate-700/70 hover:text-slate-900 dark:hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Camera
                  </button>
                </div>
                {newNoteFiles.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-slate-600 dark:text-slate-400">{newNoteFiles.length} file(s) selected</p>
                      <button
                        type="button"
                        onClick={() => setNewNoteFiles([])}
                        disabled={!canAddEditNotes || isSaving}
                        className="text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {newNoteObjectUrls.map(({ file, url }) => {
                        const isImage = file.type.startsWith('image/');
                        const isPdf = file.type === 'application/pdf';
                        if (isImage) {
                          return (
                            <div key={`${file.name}-${file.lastModified}-${file.size}`} className="rounded-lg overflow-hidden border border-gray-300 dark:border-slate-600/50 bg-white dark:bg-slate-800/70">
                              <img src={url} alt={file.name} className="w-full h-24 object-cover" />
                              <p className="px-2 py-1 text-[10px] text-slate-600 dark:text-slate-400 truncate">{file.name}</p>
                            </div>
                          );
                        }
                        return (
                          <div key={`${file.name}-${file.lastModified}-${file.size}`} className="rounded-lg border border-gray-300 dark:border-slate-600/50 bg-white dark:bg-slate-800/70 p-2">
                            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate">
                              {isPdf ? 'PDF' : 'File'}
                            </p>
                            <p className="text-[10px] text-slate-600 dark:text-slate-400 truncate mt-1">{file.name}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              <button
                type="submit"
                disabled={!canAddEditNotes || isSaving || (!newNoteContent.trim() && newNoteFiles.length === 0)}
                className="w-full px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl font-semibold hover:from-blue-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-500/30"
              >
                {isSaving ? 'Adding...' : uploadingNoteId ? 'Uploading attachments...' : 'Add Note'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Camera Modal */}
      {isCameraOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700/60 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
            <div className="p-4 border-b border-gray-200 dark:border-slate-700/60 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Camera</h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Take a photo, then click “Done” to attach it.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCameraOpen(false)}
                className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white px-3 py-2 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800/70 transition-all"
              >
                Close
              </button>
            </div>

            <div className="p-4 space-y-4">
              {cameraError && (
                <div className="bg-red-500/20 border border-red-500/40 rounded-xl p-3 text-sm text-red-200">
                  {cameraError}
                </div>
              )}

              <div className="bg-black rounded-xl overflow-hidden border border-gray-300 dark:border-slate-700/50">
                <video ref={videoRef} playsInline muted className="w-full h-[360px] object-contain" />
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const file = await captureFromCamera();
                      setCameraFiles((prev) => [...prev, file]);
                    } catch (err) {
                      console.error(err);
                      setCameraError((err as Error).message);
                    }
                  }}
                  disabled={!!cameraError}
                  className="w-full sm:w-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Take photo
                </button>
                <button
                  type="button"
                  onClick={() => setCameraFiles([])}
                  disabled={cameraFiles.length === 0}
                  className="w-full sm:w-auto px-4 py-2 bg-gray-100 dark:bg-slate-800/70 border border-gray-300 dark:border-slate-700/60 text-slate-700 dark:text-slate-200 rounded-xl font-semibold hover:bg-gray-200 dark:hover:bg-slate-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Clear
                </button>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={confirmCameraPhotos}
                  disabled={cameraFiles.length === 0}
                  className="w-full sm:w-auto px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Done ({cameraFiles.length})
                </button>
              </div>

              {cameraFiles.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {cameraObjectUrls.map(({ url }, idx) => (
                    <div key={url} className="rounded-xl overflow-hidden border border-gray-300 dark:border-slate-700/50">
                      <img src={url} alt={`Captured ${idx + 1}`} className="w-full h-28 object-cover" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Confirmation Modal */}
      {showEditConfirm && editingNoteId && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800/90 border border-gray-200 dark:border-slate-700/50 rounded-2xl shadow-2xl max-w-md w-full p-6 text-slate-900 dark:text-white">
            <div className="flex items-center justify-center mb-4">
              <div className="bg-yellow-100 dark:bg-yellow-600/20 rounded-full p-3">
                <svg className="w-8 h-8 text-yellow-600 dark:text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
            </div>
            <h2 className="text-2xl font-bold text-center mb-2">Confirm Edit</h2>
            <p className="text-slate-700 dark:text-slate-300 text-center mb-6">
              Are you sure you want to save these changes to the note?
            </p>

            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4 mb-6">
              <p className="font-semibold text-yellow-700 dark:text-yellow-300 mb-2">This will update the note content.</p>
              <p className="text-yellow-600 dark:text-yellow-200 text-sm">
              The note will be marked as edited and the timestamp will be updated.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleConfirmSaveEdit}
                disabled={isEditing}
                className="w-full sm:flex-1 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-xl font-semibold transition-all shadow-lg shadow-yellow-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isEditing ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                onClick={() => {
                  setShowEditConfirm(false);
                }}
                disabled={isEditing}
                className="mt-3 sm:mt-0 w-full sm:w-auto px-4 py-2 bg-gray-200 dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-700 dark:text-slate-300 rounded-xl font-semibold hover:bg-gray-300 dark:hover:bg-slate-700/70 hover:text-slate-900 dark:hover:text-white disabled:cursor-not-allowed transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && deletingNoteId && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800/90 border border-gray-200 dark:border-slate-700/50 rounded-2xl shadow-2xl max-w-md w-full p-6 text-slate-900 dark:text-white">
            <div className="flex items-center justify-center mb-4">
              <div className="bg-red-100 dark:bg-red-600/20 rounded-full p-3">
                <svg className="w-8 h-8 text-red-600 dark:text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
            </div>
            <h2 className="text-2xl font-bold text-center mb-2">Confirm Deletion</h2>
            <p className="text-slate-700 dark:text-slate-300 text-center mb-6">
              Are you sure you want to permanently delete this note?
            </p>

            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-6">
              <p className="font-semibold text-red-700 dark:text-red-300 mb-2">This action cannot be undone.</p>
              <p className="text-red-600 dark:text-red-200 text-sm">
              The note will be permanently removed from this job.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleConfirmDelete}
                disabled={isSaving}
                className="w-full sm:flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold transition-all shadow-lg shadow-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? 'Deleting...' : 'Delete Note'}
              </button>
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeletingNoteId(null);
                }}
                disabled={isSaving}
                className="mt-3 sm:mt-0 w-full sm:w-auto px-4 py-2 bg-gray-200 dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-700 dark:text-slate-300 rounded-xl font-semibold hover:bg-gray-300 dark:hover:bg-slate-700/70 hover:text-slate-900 dark:hover:text-white disabled:cursor-not-allowed transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
