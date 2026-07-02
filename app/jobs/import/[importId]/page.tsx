'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import DashboardSidebar from '@/components/DashboardSidebar';
import UserPickerCombobox from '@/components/UserPickerCombobox';
import AccessDeniedOverlay from '@/components/AccessDeniedOverlay';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { uploadImportDraftAttachments } from '@/lib/importDraftAttachmentUploadClient';
import type {
  ImportDuplicateAction,
  ImportDuplicateDecision,
  ImportParsedJobInfo,
  ImportParsedLineItem,
  JobImportDraftAttachment,
  JobImportRecordResponse,
  JobImportReviewSnapshot,
} from '@/lib/jobImportTypes';

function cloneSnapshot(snapshot: JobImportReviewSnapshot): JobImportReviewSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as JobImportReviewSnapshot;
}

function isDeprecatedCatalogMismatch(value: string | null | undefined): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'catalog_description_mismatch' || normalized === 'catalog description mismatch';
}

function filterVisibleWarnings(values: Array<string | null | undefined>): string[] {
  return values
    .map((value) => String(value || '').trim())
    .filter((value) => value && !isDeprecatedCatalogMismatch(value));
}

function formatLineItemWarning(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_');

  switch (normalized) {
    case 'extra_numeric_tokens':
      return 'Extra numbers were found near this row. Please confirm the part number and quantities.';
    case 'tail_row_guard':
      return 'This row was near the edge of the table, so the safer PDF reading was kept.';
    case 'vision_disagreement_retained_ocr':
    case 'verification_disagreed,_so_the_more_reliable_ocr/layout_row_was_kept.':
      return 'PDF checks found a different reading. We kept the value that looked most reliable.';
    case 'row_auto_corrected_from_vision':
      return 'This row was automatically corrected after checking the PDF.';
    case 'possible_row_merge_corrected':
      return 'This may have been blended with another row and was corrected automatically.';
    case 'vision_added_row':
      return 'This row was added after checking the PDF.';
    case 'duplicate_part_number':
      return 'This part number appears more than once. Please confirm this is expected.';
    case 'invalid_part_number_format':
      return 'The part number format looks unusual. Please confirm it is correct.';
    case 'quantity_mismatch':
      return 'The quantities did not match across checks. Please confirm them.';
    case 'manual_line_item':
      return 'This row was added manually during review.';
    default:
      return value.replace(/_/g, ' ');
  }
}

function getLineItemDisplayWarnings(item: ImportParsedLineItem): string[] {
  return Array.from(
    new Set(
      filterVisibleWarnings([
        ...(item.verificationWarnings || []),
        ...(item.validationFlags || []),
        ...(item.warnings || []),
      ]).map(formatLineItemWarning),
    ),
  );
}

function getRowOrderValue(item: ImportParsedLineItem, index: number): number {
  return typeof item.rowOrder === 'number' && Number.isFinite(item.rowOrder) ? item.rowOrder : index + 1;
}

function reindexLineItems(lineItems: ImportParsedLineItem[]): ImportParsedLineItem[] {
  return lineItems.map((item, index) => ({
    ...item,
    rowOrder: index + 1,
  }));
}

function sortLineItemsForDisplay(lineItems: ImportParsedLineItem[]): ImportParsedLineItem[] {
  return [...lineItems].sort((left, right) => {
    const leftOrder = getRowOrderValue(left, 0);
    const rightOrder = getRowOrderValue(right, 0);
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.id.localeCompare(right.id);
  });
}

function moveLineItemById(lineItems: ImportParsedLineItem[], sourceId: string, targetId: string): ImportParsedLineItem[] {
  const ordered = sortLineItemsForDisplay(lineItems);
  const sourceIndex = ordered.findIndex((item) => item.id === sourceId);
  const targetIndex = ordered.findIndex((item) => item.id === targetId);
  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
    return reindexLineItems(ordered);
  }

  const next = [...ordered];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return reindexLineItems(next);
}

function upsertDecision(
  decisions: ImportDuplicateDecision[],
  nextDecision: ImportDuplicateDecision,
): ImportDuplicateDecision[] {
  const existingIndex = decisions.findIndex((decision) => decision.partNumber === nextDecision.partNumber);
  if (existingIndex === -1) {
    return [...decisions, nextDecision];
  }

  return decisions.map((decision, index) => (index === existingIndex ? nextDecision : decision));
}

function createBlankLineItem(index: number): ImportParsedLineItem {
  return {
    id: `manual-${Date.now()}-${index}`,
    partNumber: '',
    quantityNeeded: 0,
    quantityFab: 0,
    quantityLoose: 0,
    description: '',
    unitOfMeasurement: '',
    type: '',
    sourceNeeded: 0,
    sourceFab: 0,
    sourceLoose: 0,
    uomFromPdf: null,
    warnings: ['Line manually added during review.'],
    unknownPart: true,
    reviewStatus: 'user_confirmed',
    resolutionSource: 'user',
    confidenceScore: null,
    validationFlags: ['manual_line_item'],
    verificationWarnings: ['manual_line_item'],
    arbitrationNotes: ['Line manually added during review.'],
    evidence: {
      page: null,
      bbox: null,
      ocrText: 'Line manually added during review.',
      primaryCandidate: null,
      secondaryCandidate: null,
      catalogMatch: null,
    },
    rowOrder: index,
    sectionName: null,
    provenance: {
      partNumber: 'user-edited',
      quantityNeeded: 'user-edited',
      quantityFab: 'user-edited',
      description: 'user-edited',
      unitOfMeasurement: 'user-edited',
    },
  };
}

type ImportReviewTabId = 'overview' | 'lineItems' | 'duplicates' | 'notesAccess';

interface ImportAccessGrantRow {
  id: string;
  email: string;
}

function newImportAccessGrantRow(): ImportAccessGrantRow {
  return {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `iag-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    email: '',
  };
}

export default function JobImportWorkspacePage() {
  const params = useParams<{ importId: string }>();
  const router = useRouter();
  const { data: session, status } = useSession();
  const { hasPermission, isLoading: permissionsLoading } = usePermissions();

  const importId = String(params?.importId || '');
  const currentUserEmail = session?.user?.email?.trim().toLowerCase() ?? '';
  const creatingUserEmail = currentUserEmail;
  const [jobImport, setJobImport] = useState<JobImportRecordResponse | null>(null);
  const [draftSnapshot, setDraftSnapshot] = useState<JobImportReviewSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isReparsing, setIsReparsing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isSyncingTargetList, setIsSyncingTargetList] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [importAccessGrantsError, setImportAccessGrantsError] = useState<string | null>(null);
  const [users, setUsers] = useState<Array<{ email: string; name: string | null }>>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [accessGrantRows, setAccessGrantRows] = useState<ImportAccessGrantRow[]>(() => [
    newImportAccessGrantRow(),
  ]);
  const [draftAttachments, setDraftAttachments] = useState<JobImportDraftAttachment[]>([]);
  const [isUploadingDraftAttachments, setIsUploadingDraftAttachments] = useState(false);
  const [draftAttachmentError, setDraftAttachmentError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draggedLineItemId, setDraggedLineItemId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ImportReviewTabId>('overview');
  const mainContentRef = useRef<HTMLDivElement | null>(null);
  const headerFieldsSectionRef = useRef<HTMLElement | null>(null);
  const [headerFieldsHeight, setHeaderFieldsHeight] = useState<number | null>(null);
  const [lockWarningPanelHeight, setLockWarningPanelHeight] = useState(false);
  const jobHeaderFieldValueAtFocusRef = useRef<Partial<Record<keyof ImportParsedJobInfo, string>>>({});
  const lastSavedDraftJsonRef = useRef<string | null>(null);
  const lastSavingDraftJsonRef = useRef<string | null>(null);
  const currentSavePromiseRef = useRef<Promise<boolean> | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const hasLoadedDraftRef = useRef(false);
  const latestDraftSnapshotRef = useRef<JobImportReviewSnapshot | null>(null);
  const latestAccessGrantRowsRef = useRef<ImportAccessGrantRow[]>([]);
  const isOwnDraft = jobImport?.createdBy?.trim().toLowerCase() === currentUserEmail;
  const canViewJobImport = hasPermission('job_import.view');
  const canUploadJobImport = hasPermission('job_import.upload');
  const canViewOwnDrafts = hasPermission('job_import.drafts.view_own');
  const canViewAllDrafts = hasPermission('job_import.drafts.view_all');
  const canEditOthersDrafts = hasPermission('job_import.drafts.edit_others');
  const canManageOwnDrafts = canViewOwnDrafts || canUploadJobImport;
  const canViewDraft =
    Boolean(jobImport) && ((isOwnDraft && canManageOwnDrafts) || canViewAllDrafts);
  const canEdit =
    Boolean(jobImport) &&
    ((isOwnDraft && canManageOwnDrafts) ||
      (canViewAllDrafts && canEditOthersDrafts));
  const canCommitImport = canEdit && hasPermission('job_import.commit');
  const createJobDisabledReason = !canCommitImport
    ? 'You do not have permission to commit this import as a job.'
    : isSyncingTargetList
      ? 'Wait for the target list update to finish before creating the job.'
      : '';

  useEffect(() => {
    latestDraftSnapshotRef.current = draftSnapshot;
  }, [draftSnapshot]);

  useEffect(() => {
    latestAccessGrantRowsRef.current = accessGrantRows;
  }, [accessGrantRows]);

  const normalizeAccessGrantRowsForDraft = useCallback((rows: ImportAccessGrantRow[]) => {
    const byEmail = new Map<string, { userEmail: string }>();
    for (const row of rows) {
      const userEmail = row.email.trim();
      if (!userEmail) continue;
      byEmail.set(userEmail.toLowerCase(), { userEmail });
    }
    return Array.from(byEmail.values());
  }, []);

  const hydrateAccessGrantRows = useCallback((jobImportResponse: JobImportRecordResponse) => {
    const saved = jobImportResponse.draftState?.accessGrants || [];
    if (saved.length === 0) {
      setAccessGrantRows([newImportAccessGrantRow()]);
      return;
    }
    setAccessGrantRows([
      ...saved.map((grant) => ({
        id: newImportAccessGrantRow().id,
        email: grant.userEmail,
      })),
      newImportAccessGrantRow(),
    ]);
  }, []);

  const loadDraftAttachments = useCallback(async () => {
    if (!importId) return;
    const response = await fetch(`/api/job-imports/${encodeURIComponent(importId)}/draft-attachments`);
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.error || 'Failed to load draft attachments.');
    }
    setDraftAttachments(data?.attachments || []);
  }, [importId]);

  const loadImport = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!importId) return;

        try {
          if (!options?.silent) {
            setIsLoading(true);
          }
          setPageError(null);
          setAccessDenied(false);
          const response = await fetch(`/api/job-imports/${encodeURIComponent(importId)}`);
          const data = await response.json();
          if (!response.ok) {
            if (response.status === 403) {
              setAccessDenied(true);
              setJobImport(null);
              setDraftSnapshot(null);
              return;
            }
            throw new Error(data.error || 'Failed to load import.');
          }
        setJobImport(data.import);
        const loadedSnapshot = data.import.reviewSnapshot ? cloneSnapshot(data.import.reviewSnapshot) : null;
        setDraftSnapshot(loadedSnapshot);
        hydrateAccessGrantRows(data.import);
        await loadDraftAttachments();
        const draftJson = loadedSnapshot
          ? JSON.stringify({
              reviewSnapshot: loadedSnapshot,
              draftState: {
                accessGrants: normalizeAccessGrantRowsForDraft(
                  (data.import.draftState?.accessGrants || []).map((grant: any) => ({
                    id: newImportAccessGrantRow().id,
                    email: grant.userEmail,
                  })),
                ),
              },
            })
          : null;
        lastSavedDraftJsonRef.current = draftJson;
        lastSavingDraftJsonRef.current = null;
        hasLoadedDraftRef.current = true;
        setSaveStatus(draftJson ? 'saved' : 'idle');
        setSaveError(null);
      } catch (error) {
        setPageError((error as Error).message || 'Failed to load import.');
      } finally {
        if (!options?.silent) {
          setIsLoading(false);
        }
      }
    },
    [hydrateAccessGrantRows, importId, loadDraftAttachments, normalizeAccessGrantRowsForDraft],
  );

    useEffect(() => {
      if (status === 'loading' || permissionsLoading) return;
      if (!session) {
        router.push(`/login?callbackUrl=/jobs/import/${encodeURIComponent(importId)}`);
        return;
      }
      if (!canViewJobImport || (!canManageOwnDrafts && !canViewAllDrafts)) {
        setAccessDenied(true);
        setIsLoading(false);
        return;
      }
      void loadImport();
    }, [
      canManageOwnDrafts,
      canViewAllDrafts,
      canViewJobImport,
      importId,
      loadImport,
      permissionsLoading,
      router,
      session,
      status,
    ]);

  useEffect(() => {
    if (!canEdit || status === 'loading' || permissionsLoading) return;
    const loadUsers = async () => {
      try {
        setIsLoadingUsers(true);
        const response = await fetch('/api/users/for-access');
        if (!response.ok) {
          throw new Error('Failed to load users');
        }
        const data = await response.json();
        setUsers(data.users || []);
      } catch (err) {
        console.error('Error loading users for import workspace:', err);
      } finally {
        setIsLoadingUsers(false);
      }
    };
    void loadUsers();
  }, [canEdit, permissionsLoading, status]);

  useEffect(() => {
    if (jobImport?.status !== 'PROCESSING') return;
    const intervalId = window.setInterval(() => {
      void loadImport({ silent: true });
    }, 2000);
    return () => window.clearInterval(intervalId);
  }, [jobImport?.status, loadImport]);

  const warningSummary = useMemo(() => {
    if (!draftSnapshot) return { error: 0, warning: 0, info: 0 };
    return draftSnapshot.warnings
      .filter((warning) => !isDeprecatedCatalogMismatch(warning.code) && !isDeprecatedCatalogMismatch(warning.message))
      .reduce(
      (acc, warning) => {
        acc[warning.severity] += 1;
        return acc;
      },
      { error: 0, warning: 0, info: 0 },
      );
  }, [draftSnapshot]);

  const isExistingJobUpdate = draftSnapshot?.mode === 'existing_job_update';
  const targetContext = draftSnapshot?.targetContext || null;
  const requiresTargetListSelection = Boolean(
    isExistingJobUpdate && targetContext?.requiresListSelection && !targetContext.listSelectionConfirmed,
  );
  const resolvedLineItems = useMemo(
    () => sortLineItemsForDisplay(draftSnapshot?.lineItems || []),
    [draftSnapshot],
  );
  const hasCommitBlockingIssues = Boolean(
    draftSnapshot &&
      (!draftSnapshot.formatTrusted ||
        draftSnapshot.missingRequiredFields.length > 0 ||
        draftSnapshot.blockingIssues.length > 0 ||
        requiresTargetListSelection),
  );

  const visibleWarningCards = useMemo(
    () =>
      [
        {
          key: 'error',
          label: 'Errors',
          count: warningSummary.error,
          className: 'bg-red-50 dark:bg-red-500/10',
          valueClassName: 'text-red-700 dark:text-red-200',
          labelClassName: 'text-red-600 dark:text-red-300',
        },
        {
          key: 'warning',
          label: 'Warnings',
          count: warningSummary.warning,
          className: 'bg-amber-50 dark:bg-amber-500/10',
          valueClassName: 'text-amber-700 dark:text-amber-200',
          labelClassName: 'text-amber-600 dark:text-amber-300',
        },
        {
          key: 'info',
          label: 'Info',
          count: warningSummary.info,
          className: 'bg-blue-50 dark:bg-blue-500/10',
          valueClassName: 'text-blue-700 dark:text-blue-200',
          labelClassName: 'text-blue-600 dark:text-blue-300',
        },
      ].filter((card) => card.count > 0),
    [warningSummary],
  );

  const lineItemWarningCount = useMemo(
    () =>
      resolvedLineItems.reduce((count, item) => {
        const visibleWarnings = getLineItemDisplayWarnings(item);
        return count + visibleWarnings.length + (item.unknownPart ? 1 : 0);
      }, 0),
    [resolvedLineItems],
  );

  const duplicateReviewCount = draftSnapshot?.duplicateInfo?.exists
    ? draftSnapshot.duplicateInfo.duplicateParts.length
    : 0;

  const overviewAttentionCount =
    warningSummary.error +
    warningSummary.warning +
    (draftSnapshot && !draftSnapshot.formatTrusted ? 1 : 0) +
    (draftSnapshot?.missingRequiredFields.length || 0) +
    (draftSnapshot?.blockingIssues.length || 0) +
    (requiresTargetListSelection ? 1 : 0);

  const notesAccessAttentionCount = importAccessGrantsError ? 1 : 0;

  const tabItems: Array<{
    id: ImportReviewTabId;
    label: string;
    badge?: number;
  }> = [
    { id: 'overview', label: 'Overview & Warnings', badge: overviewAttentionCount },
    { id: 'lineItems', label: 'Line Items', badge: lineItemWarningCount },
    { id: 'duplicates', label: 'Duplicates', badge: duplicateReviewCount },
    { id: 'notesAccess', label: 'Notes & Access', badge: notesAccessAttentionCount },
  ];

  useEffect(() => {
    mainContentRef.current?.scrollTo({ top: 0 });
  }, [activeTab]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(min-width: 1280px)');
    const updateMatch = () => setLockWarningPanelHeight(mediaQuery.matches);
    updateMatch();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateMatch);
      return () => mediaQuery.removeEventListener('change', updateMatch);
    }

    mediaQuery.addListener(updateMatch);
    return () => mediaQuery.removeListener(updateMatch);
  }, []);

  useEffect(() => {
    if (!lockWarningPanelHeight || !headerFieldsSectionRef.current || typeof ResizeObserver === 'undefined') {
      if (!lockWarningPanelHeight) {
        setHeaderFieldsHeight(null);
      }
      return;
    }

    const element = headerFieldsSectionRef.current;
    const updateHeight = () => setHeaderFieldsHeight(element.offsetHeight);
    updateHeight();

    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(element);

    return () => observer.disconnect();
  }, [activeTab, draftSnapshot, lockWarningPanelHeight]);

  /** Updates displayed header value only; does not add fieldCandidates until blur (see commitJobHeaderFieldIfChanged). */
  const setJobHeaderFieldLive = (field: keyof ImportParsedJobInfo, value: string) => {
    setDraftSnapshot((current) => {
      if (!current) return current;
      const next = cloneSnapshot(current);
      next.jobInfo[field] = value;
      return next;
    });
  };

  /** Records the field value when the user focuses the input (for one-shot user-edited candidate on blur). */
  const rememberJobHeaderFieldAtFocus = (field: keyof ImportParsedJobInfo) => {
    const v = draftSnapshot?.jobInfo[field];
    jobHeaderFieldValueAtFocusRef.current[field] = typeof v === 'string' ? v : String(v ?? '');
  };

  /** After typing: add a single user-edited candidate only if the value changed since focus. */
  const commitJobHeaderFieldIfChanged = (field: keyof ImportParsedJobInfo, value: string) => {
    const atFocus = jobHeaderFieldValueAtFocusRef.current[field] ?? '';
    if (atFocus === value) return;

    setDraftSnapshot((current) => {
      if (!current) return current;
      const next = cloneSnapshot(current);
      next.jobInfo[field] = value;
      const rest = (next.fieldCandidates[field] || []).filter((candidate) => candidate.sourceKind !== 'user-edited');
      next.fieldCandidates[field] = [
        {
          value,
          sourceKind: 'user-edited',
          confidence: null,
          note: 'Updated during review.',
          selected: true,
        },
        ...rest
          .filter((candidate) => candidate.value !== value)
          .map((candidate) => ({ ...candidate, selected: false })),
      ];
      return next;
    });
    setNotice(null);
  };

  const selectCandidate = (field: keyof ImportParsedJobInfo, value: string) => {
    setDraftSnapshot((current) => {
      if (!current) return current;
      const next = cloneSnapshot(current);
      next.jobInfo[field] = value;
      next.fieldCandidates[field] = (next.fieldCandidates[field] || []).map((candidate) => ({
        ...candidate,
        selected: candidate.value === value,
      }));
      return next;
    });
  };

  const updateLineItem = (
    itemId: string,
    field: keyof ImportParsedLineItem,
    value: string | number | boolean,
  ) => {
    setDraftSnapshot((current) => {
      if (!current) return current;
      const next = cloneSnapshot(current);
      next.lineItems = next.lineItems.map((item) => {
        if (item.id !== itemId) return item;
        const updated = { ...item } as ImportParsedLineItem;
        if (field === 'quantityNeeded' || field === 'quantityFab' || field === 'quantityLoose') {
          const numericValue = Math.max(0, Math.round(Number(value) || 0));
          (updated[field] as number) = numericValue;
          if (field === 'quantityFab' || field === 'quantityLoose') {
            updated.quantityNeeded = Math.max(updated.quantityNeeded, updated.quantityLoose + updated.quantityFab);
          }
        } else if (field === 'unknownPart') {
          updated.unknownPart = Boolean(value);
        } else {
          (updated[field] as string | null) = String(value);
        }
        updated.provenance = {
          ...updated.provenance,
          [field]:
            field === 'partNumber' ||
            field === 'quantityNeeded' ||
            field === 'quantityFab' ||
            field === 'description' ||
            field === 'unitOfMeasurement'
              ? 'user-edited'
              : updated.provenance?.[field as keyof typeof updated.provenance],
        };
        updated.reviewStatus = 'user_confirmed';
        updated.resolutionSource = 'user';
        return updated;
      });
      return next;
    });
  };

  const removeLineItem = (itemId: string) => {
    setDraftSnapshot((current) => {
      if (!current) return current;
      const next = cloneSnapshot(current);
      next.lineItems = reindexLineItems(next.lineItems.filter((item) => item.id !== itemId));
      return next;
    });
  };

  const addLineItem = () => {
    setDraftSnapshot((current) => {
      if (!current) return current;
      const next = cloneSnapshot(current);
      next.lineItems = reindexLineItems([
        ...sortLineItemsForDisplay(next.lineItems),
        createBlankLineItem(next.lineItems.length + 1),
      ]);
      return next;
    });
  };

  const reorderLineItems = (sourceId: string, targetId: string) => {
    setDraftSnapshot((current) => {
      if (!current) return current;
      const next = cloneSnapshot(current);
      next.lineItems = moveLineItemById(next.lineItems, sourceId, targetId);
      return next;
    });
    setNotice(null);
  };

  const setWorkspaceNote = (value: string) => {
    setDraftSnapshot((current) => {
      if (!current) return current;
      const next = cloneSnapshot(current);
      next.workspaceNote = value;
      return next;
    });
  };

  const addImportNoteFiles = async (files: File[]) => {
    if (files.length === 0) return;
    try {
      setIsUploadingDraftAttachments(true);
      setDraftAttachmentError(null);
      const result = await uploadImportDraftAttachments({
        importId,
        files,
        onError: setDraftAttachmentError,
      });
      if (result.successful.length > 0) {
        setDraftAttachments((prev) => [...prev, ...result.successful]);
      }
    } finally {
      setIsUploadingDraftAttachments(false);
    }
  };

  const removeImportNoteFile = async (attachmentId: string) => {
    if (!attachmentId) return;
    const previous = draftAttachments;
    setDraftAttachments((prev) => prev.filter((attachment) => attachment.id !== attachmentId));
    try {
      const response = await fetch(
        `/api/job-imports/${encodeURIComponent(importId)}/draft-attachments?id=${encodeURIComponent(attachmentId)}`,
        { method: 'DELETE' },
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to remove attachment.');
      }
    } catch (error) {
      setDraftAttachments(previous);
      setDraftAttachmentError((error as Error).message || 'Failed to remove attachment.');
    }
  };

  const updateDuplicateDecision = (
    partNumber: string,
    action: ImportDuplicateAction,
    customQuantity?: number,
  ) => {
    setDraftSnapshot((current) => {
      if (!current) return current;
      const next = cloneSnapshot(current);
      next.duplicateDecisions = upsertDecision(next.duplicateDecisions, {
        partNumber,
        action,
        customQuantity: action === 'custom' ? Math.max(0, Math.round(customQuantity || 0)) : null,
      });
      return next;
    });
  };

  const syncTargetListSelection = async (nextListNumber: string) => {
    if (!draftSnapshot || !isExistingJobUpdate || !targetContext) return;

    const nextSnapshot = cloneSnapshot(draftSnapshot);
    nextSnapshot.targetContext = {
      ...targetContext,
      listNumber: nextListNumber,
      listSelectionConfirmed: true,
    };
    nextSnapshot.jobInfo.jobNumber = targetContext.jobNumber || nextSnapshot.jobInfo.jobNumber;
    nextSnapshot.jobInfo.jobName = targetContext.jobName || nextSnapshot.jobInfo.jobName;
    nextSnapshot.jobInfo.listNumber = nextListNumber;

    setDraftSnapshot(nextSnapshot);

    try {
      setIsSyncingTargetList(true);
      setPageError(null);
      setNotice(null);
      const response = await fetch(`/api/job-imports/${encodeURIComponent(importId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildDraftSavePayload(nextSnapshot, latestAccessGrantRowsRef.current)),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update the target list.');
      }

      setJobImport(data.import);
      setDraftSnapshot(data.import.reviewSnapshot ? cloneSnapshot(data.import.reviewSnapshot) : null);
      lastSavedDraftJsonRef.current = JSON.stringify(
        buildDraftSavePayload(
          data.import.reviewSnapshot ? cloneSnapshot(data.import.reviewSnapshot) : nextSnapshot,
          latestAccessGrantRowsRef.current,
        ),
      );
      setSaveStatus('saved');
      setSaveError(null);
      setNotice(`Target list updated to ${nextListNumber}.`);
    } catch (error) {
      setPageError((error as Error).message || 'Failed to update the target list.');
    } finally {
      setIsSyncingTargetList(false);
    }
  };

  const reparseImport = async () => {
    try {
      setIsReparsing(true);
      setPageError(null);
      setNotice(null);
      if (draftSnapshot) {
        if (autosaveTimerRef.current !== null) {
          window.clearTimeout(autosaveTimerRef.current);
          autosaveTimerRef.current = null;
        }
        const saved = await persistImportDraft({ snapshot: draftSnapshot });
        if (!saved) {
          throw new Error(saveError || 'Save the import draft before rescanning.');
        }
      }
      const response = await fetch(`/api/job-imports/${encodeURIComponent(importId)}/reparse`, {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to rescan import.');
      }
      setJobImport(data.import);
      const reparsedSnapshot = data.import.reviewSnapshot ? cloneSnapshot(data.import.reviewSnapshot) : null;
      setDraftSnapshot(reparsedSnapshot);
      if (reparsedSnapshot) {
        lastSavedDraftJsonRef.current = JSON.stringify(
          buildDraftSavePayload(reparsedSnapshot, latestAccessGrantRowsRef.current),
        );
        setSaveStatus('saved');
        setSaveError(null);
      }
      setNotice('Import rescanned.');
    } catch (error) {
      setPageError((error as Error).message || 'Failed to rescan import.');
    } finally {
      setIsReparsing(false);
    }
  };

  const validateImportAccessGrants = (): string | null => {
    const grantEmails = new Set<string>();
    for (const row of accessGrantRows) {
      const e = row.email.trim().toLowerCase();
      if (!e) continue;
      if (grantEmails.has(e)) {
        return 'Each person can only be added once';
      }
      grantEmails.add(e);
    }
    const creatorLower = creatingUserEmail.toLowerCase();
    if (creatorLower) {
      for (const row of accessGrantRows) {
        const e = row.email.trim().toLowerCase();
        if (e && e === creatorLower) {
          return 'You already have access as the job creator.';
        }
      }
    }
    return null;
  };

  const buildImportAccessGrantsPayload = (): Array<{ userEmail: string }> =>
    accessGrantRows
      .filter((row) => row.email.trim())
      .map((row) => ({
        userEmail: row.email.trim(),
      }));

  const buildDraftSavePayload = useCallback(
    (snapshot: JobImportReviewSnapshot, rows: ImportAccessGrantRow[]) => ({
      reviewSnapshot: snapshot,
      draftState: {
        accessGrants: normalizeAccessGrantRowsForDraft(rows),
        draftVersion: 1,
      },
    }),
    [normalizeAccessGrantRowsForDraft],
  );

  const persistImportDraft = useCallback(
    async (options?: { silent?: boolean; snapshot?: JobImportReviewSnapshot | null }) => {
      const snapshot = options?.snapshot ?? latestDraftSnapshotRef.current;
      if (!snapshot || !importId) return true;
      const payload = buildDraftSavePayload(snapshot, latestAccessGrantRowsRef.current);
      const draftJson = JSON.stringify(payload);
      if (
        draftJson === lastSavedDraftJsonRef.current ||
        draftJson === lastSavingDraftJsonRef.current
      ) {
        if (!currentSavePromiseRef.current) return true;
        try {
          return await currentSavePromiseRef.current;
        } catch {
          return false;
        }
      }

      lastSavingDraftJsonRef.current = draftJson;
      if (!options?.silent) {
        setSaveStatus('saving');
        setSaveError(null);
      }
      const savePromise = (async () => {
        const response = await fetch(`/api/job-imports/${encodeURIComponent(importId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.error || 'Failed to save import draft.');
        }
        setJobImport(data.import);
        lastSavedDraftJsonRef.current = draftJson;
        setSaveStatus('saved');
        setSaveError(null);
        return true;
      })();
      currentSavePromiseRef.current = savePromise;

      try {
        return await savePromise;
      } catch (error) {
        const message = (error as Error).message || 'Failed to save import draft.';
        setSaveStatus('error');
        setSaveError(message);
        return false;
      } finally {
        if (lastSavingDraftJsonRef.current === draftJson) {
          lastSavingDraftJsonRef.current = null;
        }
        if (currentSavePromiseRef.current === savePromise) {
          currentSavePromiseRef.current = null;
        }
      }
    },
    [buildDraftSavePayload, importId],
  );

  const flushPendingDraftSave = useCallback(async () => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    return await persistImportDraft();
  }, [persistImportDraft]);

  const hasImportJobNote = () =>
    Boolean(draftSnapshot?.workspaceNote?.trim()) || draftAttachments.length > 0;

  const resolveFirstBlockedTab = (accessError?: string | null): ImportReviewTabId => {
    if (accessError) return 'notesAccess';
    if (!draftSnapshot) return 'overview';

    const firstBlockingIssue = draftSnapshot.blockingIssues[0];
    if (firstBlockingIssue?.lineItemId) return 'lineItems';
    if (
      firstBlockingIssue &&
      `${firstBlockingIssue.code} ${firstBlockingIssue.message}`.toLowerCase().includes('duplicate')
    ) {
      return 'duplicates';
    }

    return 'overview';
  };

  useEffect(() => {
    if (!canEdit || !hasLoadedDraftRef.current || !draftSnapshot || isCommitting || jobImport?.status !== 'READY') return;
    const payload = buildDraftSavePayload(draftSnapshot, accessGrantRows);
    const draftJson = JSON.stringify(payload);
    if (draftJson === lastSavedDraftJsonRef.current) return;
    setSaveStatus('saving');
    setSaveError(null);
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      void persistImportDraft();
    }, 900);
    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [
    accessGrantRows,
    buildDraftSavePayload,
    canEdit,
    draftSnapshot,
    isCommitting,
    jobImport?.status,
    persistImportDraft,
  ]);

  const hasUnsavedDraftSave = useCallback(() => {
    if (!canEdit) return false;
    const snapshot = latestDraftSnapshotRef.current;
    if (!snapshot) return false;
    if (saveStatus === 'saving' || saveStatus === 'error') return true;
    const draftJson = JSON.stringify(buildDraftSavePayload(snapshot, latestAccessGrantRowsRef.current));
    return draftJson !== lastSavedDraftJsonRef.current;
  }, [buildDraftSavePayload, canEdit, saveStatus]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedDraftSave()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedDraftSave]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!hasUnsavedDraftSave()) return;
      const target = event.target as HTMLElement | null;
      const link = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link) return;
      if (link.target && link.target !== '_self') return;
      const href = link.getAttribute('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      event.preventDefault();
      event.stopPropagation();
      void (async () => {
        const saved = await flushPendingDraftSave();
        if (!saved) {
          const confirmed = window.confirm(
            'Your latest import draft changes could not be saved. Leave anyway?',
          );
          if (!confirmed) return;
        }
        window.location.href = link.href;
      })();
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [flushPendingDraftSave, hasUnsavedDraftSave]);

  const buildCommittedJobUrl = (jobNumber: string, listNumber: string, noteId?: string | null) => {
    const params = new URLSearchParams({ list: listNumber || '1' });
    if (noteId) {
      params.set('tab', 'notes');
      params.set('openNoteId', noteId);
    }
    return `/job/${encodeURIComponent(jobNumber)}?${params.toString()}`;
  };

  const createImportJobNote = async (
    jobNumber: string,
    listNumber: string,
    existingNoteId?: string | null,
  ): Promise<string | null> => {
    const content = draftSnapshot?.workspaceNote?.trim() || '';
    if (!content && draftAttachments.length === 0) return null;

    let noteId = existingNoteId ?? null;
    const query = new URLSearchParams({ listNumber: listNumber || '1' });
    if (!noteId) {
      const response = await fetch(
        `/api/jobs/${encodeURIComponent(jobNumber)}/notes?${query.toString()}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content,
            notify: false,
          }),
        },
      );

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          `Import was committed, but the job note could not be saved. Open the job here and add it from the Notes tab: ${buildCommittedJobUrl(jobNumber, listNumber)}. ${data?.error || ''}`.trim(),
        );
      }

      noteId = data?.note?.id;
      if (!noteId || typeof noteId !== 'string') {
        throw new Error(
          `Import was committed, but the job note response was missing a note id. Open the job here: ${buildCommittedJobUrl(jobNumber, listNumber)}`,
        );
      }
    }

    return noteId;
  };

  const commitImport = async () => {
    if (!draftSnapshot || !canCommitImport) return;
    const accessErr = validateImportAccessGrants();
    if (accessErr) {
      setActiveTab(resolveFirstBlockedTab(accessErr));
      setImportAccessGrantsError(accessErr);
      return;
    }
    if (hasCommitBlockingIssues) {
      setActiveTab(resolveFirstBlockedTab());
      setPageError('Resolve the commit blockers before creating the job.');
      return;
    }
    setImportAccessGrantsError(null);
    try {
      setIsCommitting(true);
      setPageError(null);
      setNotice(null);
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      const saved = await persistImportDraft({ snapshot: draftSnapshot });
      if (!saved) {
        throw new Error(saveError || 'Save the import draft before creating the job.');
      }
      const accessGrants = buildImportAccessGrantsPayload();
      const reviewSnapshotForCommit = hasImportJobNote()
        ? { ...draftSnapshot, workspaceNote: null }
        : draftSnapshot;
      const commitBody: Record<string, unknown> = { reviewSnapshot: reviewSnapshotForCommit };
      if (hasImportJobNote()) {
        commitBody.initialNote = {
          content: draftSnapshot.workspaceNote?.trim() || '',
          hasAttachments: draftAttachments.length > 0,
        };
      }
      if (accessGrants.length > 0) {
        commitBody.accessGrants = accessGrants;
      }
      const response = await fetch(`/api/job-imports/${encodeURIComponent(importId)}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(commitBody),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to commit import.');
      }
      const committedJobNumber = String(data.committedJobNumber || '');
      const committedListNumber = String(data.committedListNumber || '1');
      const noteId = await createImportJobNote(
        committedJobNumber,
        committedListNumber,
        typeof data.initialNoteId === 'string' ? data.initialNoteId : null,
      );
      router.push(buildCommittedJobUrl(committedJobNumber, committedListNumber, noteId));
    } catch (error) {
      setPageError((error as Error).message || 'Failed to commit import.');
    } finally {
      setIsCommitting(false);
    }
  };

  const isImportAccessDenied =
    !permissionsLoading && status !== 'loading' && (accessDenied || (Boolean(jobImport) && !canViewDraft));

  if (isImportAccessDenied) {
    return (
      <div className="h-screen bg-slate-100 dark:bg-slate-900 flex">
        <DashboardSidebar />
        <div className="pointer-events-none flex-1 select-none overflow-hidden p-6 blur-sm opacity-60">
          <div className="h-full rounded-2xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60">
            <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-700/50">
              <div className="h-7 w-64 rounded bg-slate-200 dark:bg-slate-700" />
              <div className="mt-3 h-4 w-96 max-w-full rounded bg-slate-200 dark:bg-slate-700" />
            </div>
            <div className="grid gap-4 p-6 lg:grid-cols-3">
              <div className="h-40 rounded-xl bg-slate-200/80 dark:bg-slate-700/50" />
              <div className="h-40 rounded-xl bg-slate-200/80 dark:bg-slate-700/50" />
              <div className="h-40 rounded-xl bg-slate-200/80 dark:bg-slate-700/50" />
            </div>
          </div>
        </div>
        <AccessDeniedOverlay message="You do not have permission to view this import draft." />
      </div>
    );
  }

  if (status === 'loading' || permissionsLoading || isLoading) {
    return (
      <div className="min-h-screen bg-slate-100 dark:bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">Loading import workspace…</p>
        </div>
      </div>
    );
  }

  if (jobImport && jobImport.status === 'PROCESSING') {
    const meta = jobImport.ocrMetadata || {};
    const parseProgress = meta.parseProgress as
      | {
          phase?: string;
          pageCount?: number;
          current?: { label?: string; pageRange?: number[]; textChunk?: number; visionChunk?: number };
          totalTextChunks?: number;
          completedTextChunks?: number;
        }
      | undefined;
    const pageLabel =
      parseProgress?.current?.label ||
      (parseProgress?.current?.pageRange
        ? `Pages ${parseProgress.current.pageRange[0]}–${parseProgress.current.pageRange[1]}`
        : null);

    return (
      <div className="h-screen bg-slate-100 dark:bg-slate-900 flex">
        <DashboardSidebar />
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center dark:border-slate-700/50 dark:bg-slate-800">
            <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
            <h1 className="mt-5 text-xl font-bold text-slate-900 dark:text-white">Parsing import…</h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{jobImport.sourceFileName}</p>
            {jobImport.importIntent === 'header_stub' && (
              <p className="mt-2 text-sm text-blue-700 dark:text-blue-200">
                No material table rows detected on this picksheet—using the fast header-only path (skipping line and
                vision passes).
              </p>
            )}
            {typeof parseProgress?.pageCount === 'number' && (
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {parseProgress.pageCount} PDF page{parseProgress.pageCount === 1 ? '' : 's'}
              </p>
            )}
            {parseProgress?.phase && (
              <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                Phase: <span className="font-semibold">{parseProgress.phase}</span>
              </p>
            )}
            {pageLabel && (
              <p className="mt-2 text-sm text-blue-700 dark:text-blue-200 font-medium">{pageLabel}</p>
            )}
            {typeof parseProgress?.totalTextChunks === 'number' && parseProgress.totalTextChunks > 0 && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Text chunks: {parseProgress.completedTextChunks ?? 0} / {parseProgress.totalTextChunks}
              </p>
            )}
            <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
              {jobImport.importIntent === 'header_stub'
                ? 'This usually finishes quickly. This page refreshes automatically.'
                : 'Large PDFs can take several minutes. This page refreshes automatically.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (jobImport && !draftSnapshot && jobImport.status === 'FAILED') {
    return (
      <div className="h-screen bg-slate-100 dark:bg-slate-900 flex">
        <DashboardSidebar />
        <div className="relative flex-1 flex items-center justify-center px-6">
          <button
            type="button"
            onClick={() => router.push('/jobs')}
            className="absolute left-6 top-6 inline-flex h-10 items-center gap-2 border border-slate-300 bg-white/90 pl-3 pr-4 text-sm font-semibold text-slate-700 shadow-sm backdrop-blur transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:bg-slate-700/70"
            style={{ clipPath: 'polygon(14px 0, 100% 0, 100% 100%, 14px 100%, 0 50%)' }}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div className="max-w-xl rounded-xl border border-red-200 bg-white p-6 dark:border-red-500/30 dark:bg-slate-800">
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Import Failed</h1>
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
              {jobImport.errorMessage || pageError || 'The import could not be parsed.'}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <a
                href={jobImport.sourceDownloadPath}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700/60"
              >
                View Source File
              </a>
              <button
                onClick={reparseImport}
                disabled={isReparsing || isSyncingTargetList || !canEdit}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {isReparsing ? 'Rescanning...' : 'Try Rescan'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!jobImport || !draftSnapshot) {
    return (
      <div className="min-h-screen bg-slate-100 dark:bg-slate-900 flex items-center justify-center px-6">
        <div className="max-w-lg rounded-xl border border-red-200 bg-white p-6 text-center dark:border-red-500/30 dark:bg-slate-800">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Import Not Available</h1>
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
            {pageError || 'This import could not be loaded.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh overflow-hidden bg-slate-100 dark:bg-slate-900 flex">
      <DashboardSidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="border-b border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-800/60">
          <div className="px-6 py-4 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => router.push('/jobs')}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-300/90 bg-white/80 px-3.5 text-sm font-semibold text-slate-700 shadow-sm backdrop-blur transition hover:border-slate-400 hover:bg-white dark:border-slate-600/90 dark:bg-slate-900/55 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:bg-slate-800/80"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back
                </button>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                  {isExistingJobUpdate ? 'Existing Job PDF Update Review' : 'Import Review Workspace'}
                </h1>
                <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                  <span>{jobImport.sourceFileName} · {jobImport.status}</span>
                {saveStatus !== 'idle' && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      saveStatus === 'error'
                        ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-200'
                        : saveStatus === 'saving'
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200'
                          : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200'
                    }`}
                    title={saveError || undefined}
                  >
                    {saveStatus === 'saving' ? 'Saving draft...' : saveStatus === 'error' ? 'Save failed' : 'Draft saved'}
                  </span>
                )}
                {saveStatus === 'error' && (
                  <button
                    type="button"
                    onClick={() => void persistImportDraft()}
                    className="text-xs font-semibold text-red-700 underline hover:text-red-800 dark:text-red-200 dark:hover:text-red-100"
                  >
                    Retry
                  </button>
                )}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={jobImport.sourceDownloadPath}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700/60"
              >
                View Source File
              </a>
              <button
                onClick={reparseImport}
                disabled={isReparsing || isSyncingTargetList || !canEdit}
                className="rounded-xl border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-60 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/10"
              >
                {isReparsing ? 'Rescanning...' : 'Rescan'}
              </button>
              <span title={createJobDisabledReason || undefined} className="inline-flex">
                <button
                  onClick={commitImport}
                  disabled={
                    isCommitting ||
                    isSyncingTargetList ||
                    !canCommitImport
                  }
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {isCommitting ? 'Creating Job...' : 'Create Job'}
                </button>
              </span>
            </div>
          </div>
          <div className="border-t border-slate-200 px-6 py-3 dark:border-slate-700/50">
            <div className="flex gap-2 overflow-x-auto">
              {tabItems.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                      isActive
                        ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/20'
                        : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-300 dark:hover:bg-slate-700/60'
                    }`}
                  >
                    {tab.label}
                    {tab.badge ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          isActive
                            ? 'bg-white/20 text-white'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200'
                        }`}
                      >
                        {tab.badge}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </header>

        <main ref={mainContentRef} className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 pt-6 pb-6">
          {(pageError || notice || jobImport.errorMessage) && (
            <div className="mb-6 space-y-3">
              {pageError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
                  {pageError}
                </div>
              )}
              {jobImport.errorMessage && !pageError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
                  {jobImport.errorMessage}
                </div>
              )}
              {notice && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                  {notice}
                </div>
              )}
            </div>
          )}

          {activeTab === 'overview' && (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-hidden xl:grid-cols-[1.2fr_0.8fr]">
            <section
              ref={headerFieldsSectionRef}
              className="self-start rounded-xl border border-slate-200 bg-white p-5 min-h-0 overflow-y-auto dark:border-slate-700/50 dark:bg-slate-800/60"
            >
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Header Fields</h2>
              {isExistingJobUpdate && targetContext && (
                <div className="mt-3 space-y-3">
                  <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200">
                    This review stays locked to job {targetContext.jobNumber}. Parsed identifiers are kept for warnings only and will not overwrite the current job.
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">Target List</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Choose which list on this job should receive the PDF update.
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <select
                          value={targetContext.listNumber || ''}
                          disabled={!canEdit || isSyncingTargetList}
                          onChange={(event) => void syncTargetListSelection(event.target.value)}
                          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-70 dark:border-slate-600 dark:bg-slate-900/30 dark:text-white"
                        >
                          {targetContext.availableListNumbers.map((listNumber) => (
                            <option key={listNumber} value={listNumber}>
                              List {listNumber}
                            </option>
                          ))}
                        </select>
                        {targetContext.requiresListSelection && !targetContext.listSelectionConfirmed && (
                          <>
                            <span className="text-xs font-semibold text-amber-600 dark:text-amber-300">
                              Confirmation required
                            </span>
                            <button
                              type="button"
                              onClick={() => void syncTargetListSelection(targetContext.listNumber || '')}
                              disabled={!canEdit || isSyncingTargetList || !targetContext.listNumber}
                              className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-60 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/10"
                            >
                              Use This List
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                {(
                  [
                    ['jobNumber', 'Job Number'],
                    ['jobName', 'Job Name'],
                    ['listNumber', 'List Number'],
                    ['area', 'Area'],
                    ['locationShipTo', 'Ship To / Location'],
                    ['stocklistDeliveryShipDate', 'Stocklist Date'],
                    ['deliveryDate', 'Delivery Date'],
                    ['listedBy', 'Listed By'],
                  ] as Array<[keyof ImportParsedJobInfo, string]>
                ).map(([field, label]) => (
                  <div key={field} className={field === 'locationShipTo' || field === 'jobName' ? 'md:col-span-2' : ''}>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">{label}</label>
                    <input
                      value={draftSnapshot.jobInfo[field]}
                      onFocus={() => rememberJobHeaderFieldAtFocus(field)}
                      onChange={(event) => setJobHeaderFieldLive(field, event.target.value)}
                      onBlur={(event) => commitJobHeaderFieldIfChanged(field, event.target.value)}
                      disabled={
                        !canEdit ||
                        (isExistingJobUpdate &&
                          (field === 'jobNumber' || field === 'jobName' || field === 'listNumber'))
                      }
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-70 dark:border-slate-600 dark:bg-slate-900/30 dark:text-white"
                    />
                    {isExistingJobUpdate && draftSnapshot.currentJobInfo && field !== 'jobNumber' && field !== 'jobName' && field !== 'listNumber' && (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Current value: {draftSnapshot.currentJobInfo[field] || 'Not set'}
                      </p>
                    )}
                    {(draftSnapshot.fieldCandidates[field] || []).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(draftSnapshot.fieldCandidates[field] || []).map((candidate, index) => (
                          <button
                            key={`${field}-${index}-${candidate.value}`}
                            type="button"
                            onClick={() => {
                              if (
                                isExistingJobUpdate &&
                                (field === 'jobNumber' || field === 'jobName' || field === 'listNumber')
                              ) {
                                return;
                              }
                              selectCandidate(field, candidate.value || '');
                            }}
                            className={`rounded-full border px-3 py-1 text-xs ${
                              candidate.selected
                                ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-500/10 dark:text-blue-200'
                                : 'border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300'
                            }`}
                          >
                            {(candidate.value || '(blank)') + ` · ${candidate.sourceKind}`}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section
              className="rounded-xl border border-slate-200 bg-white p-5 min-h-0 overflow-y-auto dark:border-slate-700/50 dark:bg-slate-800/60 xl:flex xl:flex-col xl:min-h-0"
              style={
                lockWarningPanelHeight && headerFieldsHeight
                  ? { height: `${headerFieldsHeight}px`, maxHeight: `${headerFieldsHeight}px` }
                  : undefined
              }
            >
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Warnings And Notes</h2>
              {visibleWarningCards.length > 0 && (
                <div
                  className={`mt-4 grid gap-3 ${
                    visibleWarningCards.length === 1
                      ? 'grid-cols-1'
                      : visibleWarningCards.length === 2
                        ? 'grid-cols-2'
                        : 'grid-cols-3'
                  }`}
                >
                  {visibleWarningCards.map((card) => (
                    <div key={card.key} className={`rounded-xl px-3 py-3 text-center ${card.className}`}>
                      <p className={`text-xl font-bold ${card.valueClassName}`}>{card.count}</p>
                      <p className={`text-xs ${card.labelClassName}`}>{card.label}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
                {!draftSnapshot.formatTrusted && (
                  <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
                    This PDF could not be resolved into a trustworthy TF material table, so commit stays blocked until the file parses cleanly.
                  </div>
                )}

                {draftSnapshot.blockingIssues.length > 0 && (
                  <div className="mt-4 rounded-xl border border-red-200 p-3 dark:border-red-500/30">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">Commit blockers</p>
                    <div className="mt-2 space-y-2">
                      {draftSnapshot.blockingIssues.map((issue, index) => (
                        <div
                          key={`${issue.code}-block-${index}`}
                          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-200"
                        >
                          {issue.message}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {draftSnapshot.warnings.filter((warning) => !isDeprecatedCatalogMismatch(warning.code) && !isDeprecatedCatalogMismatch(warning.message)).length > 0 && (
                  <div className="mt-4 space-y-2">
                    {draftSnapshot.warnings
                      .filter((warning) => !isDeprecatedCatalogMismatch(warning.code) && !isDeprecatedCatalogMismatch(warning.message))
                      .map((warning, index) => (
                      <div
                        key={`${warning.code}-${index}`}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"
                      >
                        <p className="font-semibold text-slate-900 dark:text-white">{warning.message}</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {warning.severity.toUpperCase()}
                          {warning.field ? ` · ${warning.field}` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {draftSnapshot.handwrittenNotes.length > 0 && (
                  <div className="mt-4 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">Handwritten Notes</p>
                    <ul className="mt-2 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                      {draftSnapshot.handwrittenNotes.map((note, index) => (
                        <li key={`${note}-${index}`} className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-900/30">
                          {note}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {draftSnapshot.warnings.length === 0 && draftSnapshot.handwrittenNotes.length === 0 && (
                  <div className="mt-4 rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
                    No warnings or handwritten notes for this import.
                  </div>
                )}
              </div>
            </section>
          </div>
          )}

          {activeTab === 'notesAccess' && (
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1">
          <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700/50 dark:bg-slate-800/60">
            <div className="border-b border-slate-200 pb-4 dark:border-slate-700/50">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Job Notes</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Add optional notes, access instructions, photos, or PDFs to save on the job after import.
              </p>
            </div>
            <div className="mt-4">
              <textarea
                value={draftSnapshot.workspaceNote ?? ''}
                onChange={(event) => setWorkspaceNote(event.target.value)}
                disabled={!canEdit || isCommitting}
                rows={4}
                placeholder="Access notes, jobsite instructions, gate codes, contact details..."
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-70 dark:border-slate-600 dark:bg-slate-900/30 dark:text-white"
              />
              <div
                onDragEnter={(event) => {
                  event.preventDefault();
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (!canEdit || isCommitting || isUploadingDraftAttachments) return;
                  void addImportNoteFiles(Array.from(event.dataTransfer.files || []));
                }}
                className="mt-3 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 dark:border-slate-600/70 dark:bg-slate-900/25"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <p className="flex-1 text-xs text-slate-600 dark:text-slate-400">
                    Drag files here, or upload photos and PDFs.
                  </p>
                  <label
                    className={`w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-center text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900/30 dark:text-slate-200 dark:hover:bg-slate-700/60 sm:w-auto ${
                      !canEdit || isCommitting || isUploadingDraftAttachments ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                    }`}
                  >
                    {isUploadingDraftAttachments ? 'Uploading...' : 'Upload'}
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      disabled={!canEdit || isCommitting || isUploadingDraftAttachments}
                      onChange={(event) => {
                        const files = Array.from(event.target.files || []);
                        event.currentTarget.value = '';
                        void addImportNoteFiles(files);
                      }}
                    />
                  </label>
                </div>
              </div>
              {draftAttachmentError && (
                <p className="mt-2 whitespace-pre-wrap text-xs text-red-600 dark:text-red-400">{draftAttachmentError}</p>
              )}
              {draftAttachments.length > 0 && (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      {draftAttachments.length} file{draftAttachments.length === 1 ? '' : 's'} saved to this draft
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {draftAttachments.map((attachment) => {
                      const isImage = attachment.contentType.startsWith('image/');
                      const isPdf = attachment.contentType === 'application/pdf';
                      const fileName = attachment.fileName || 'Attachment';
                      return (
                        <div
                          key={attachment.id}
                          className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/30"
                        >
                          {isImage ? (
                            <img src={attachment.url || ''} alt={fileName} className="h-24 w-full object-cover" />
                          ) : (
                            <div className="flex h-24 items-center justify-center bg-slate-100 dark:bg-slate-800/70">
                              <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                                {isPdf ? 'PDF' : 'FILE'}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center gap-2 px-2 py-1">
                            <p className="min-w-0 flex-1 truncate text-[10px] text-slate-600 dark:text-slate-400">
                              {fileName}
                            </p>
                            <button
                              type="button"
                              onClick={() => void removeImportNoteFile(attachment.id)}
                              disabled={!canEdit || isCommitting || isUploadingDraftAttachments}
                              className="text-[10px] font-semibold text-red-600 hover:text-red-700 disabled:opacity-60 dark:text-red-400 dark:hover:text-red-300"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700/50 dark:bg-slate-800/60">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Access</h2>
            {importAccessGrantsError && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">{importAccessGrantsError}</p>
            )}
            <div className="mt-4 space-y-3">
              {accessGrantRows.map((row) => {
                const excludedEmails = [
                  ...(creatingUserEmail ? [creatingUserEmail] : []),
                  ...accessGrantRows
                    .filter((r) => r.id !== row.id && r.email.trim())
                    .map((r) => r.email.trim()),
                ];
                return (
                  <div
                    key={row.id}
                    className="flex flex-col gap-3 sm:flex-row sm:items-end"
                  >
                    <div className="min-w-0 flex-1">
                      <label
                        className="block text-sm font-semibold text-slate-700 dark:text-slate-300"
                        htmlFor={`import-access-user-${row.id}`}
                      >
                        User
                      </label>
                      <div className="mt-1">
                        <UserPickerCombobox
                          id={`import-access-user-${row.id}`}
                          users={users}
                          value={row.email}
                          onChange={(email) => {
                            setImportAccessGrantsError(null);
                            setAccessGrantRows((prev) =>
                              prev.map((r) => (r.id === row.id ? { ...r, email } : r)),
                            );
                          }}
                          excludedEmails={excludedEmails}
                          disabled={isLoadingUsers || !canEdit}
                          placeholder={
                            isLoadingUsers ? 'Loading users…' : 'Search by name or email…'
                          }
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setImportAccessGrantsError(null);
                        setAccessGrantRows((prev) => {
                          const next = prev.filter((r) => r.id !== row.id);
                          return next.length > 0 ? next : [newImportAccessGrantRow()];
                        });
                      }}
                      disabled={!canEdit}
                      className="self-start rounded-lg px-3 py-2 text-sm font-semibold text-red-600 hover:text-red-700 disabled:opacity-60 dark:text-red-400 dark:hover:text-red-300 sm:mb-0.5 sm:self-auto"
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => {
                setImportAccessGrantsError(null);
                setAccessGrantRows((prev) => [...prev, newImportAccessGrantRow()]);
              }}
              disabled={!canEdit}
              className="mt-3 text-sm font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-60 dark:text-blue-400 dark:hover:text-blue-300"
            >
              + Add person
            </button>
          </section>
          </div>
          )}

          {activeTab === 'lineItems' && (
          <section className="min-h-0 flex flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60">
            <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-slate-700/50 dark:bg-slate-800/95">
              <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Line Items</h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  The import pipeline auto-verifies each row before showing it here. You can still edit anything manually.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs sm:text-sm">
                <span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200">
                  Resolved rows: {resolvedLineItems.length}
                </span>
                <span className="rounded-full bg-amber-50 px-3 py-1 font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-200">
                  Warnings: {warningSummary.warning}
                </span>
                <button
                  onClick={addLineItem}
                  disabled={!canEdit}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700/60"
                >
                  Add Line
                </button>
              </div>
            </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto pb-5">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left dark:border-slate-700">
                    <th className="sticky top-0 z-10 bg-slate-50 py-2 pl-5 pr-3 dark:bg-slate-800">Order</th>
                    <th className="sticky top-0 z-10 bg-slate-50 py-2 pr-3 dark:bg-slate-800">Part #</th>
                    <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-right dark:bg-slate-800">Loose</th>
                    <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-right dark:bg-slate-800">FAB</th>
                    <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-right dark:bg-slate-800">Needed</th>
                    <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 dark:bg-slate-800">UOM</th>
                    <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 dark:bg-slate-800">Description</th>
                    <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 dark:bg-slate-800">Status</th>
                    <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 dark:bg-slate-800">Warnings</th>
                    <th className="sticky top-0 z-10 bg-slate-50 py-2 pl-3 pr-5 text-right dark:bg-slate-800">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {resolvedLineItems.map((item) => (
                    <tr
                      key={item.id}
                      draggable={canEdit}
                      onDragStart={() => setDraggedLineItemId(item.id)}
                      onDragEnd={() => setDraggedLineItemId(null)}
                      onDragOver={(event) => {
                        if (!canEdit || !draggedLineItemId || draggedLineItemId === item.id) return;
                        event.preventDefault();
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (!canEdit || !draggedLineItemId || draggedLineItemId === item.id) return;
                        reorderLineItems(draggedLineItemId, item.id);
                        setDraggedLineItemId(null);
                      }}
                      className={`border-b border-slate-100 align-top dark:border-slate-800 ${
                        draggedLineItemId === item.id ? 'opacity-60' : ''
                      }`}
                    >
                      <td className="py-2 pl-5 pr-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={!canEdit}
                            className="cursor-grab rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 active:cursor-grabbing dark:border-slate-600 dark:text-slate-300"
                            title="Drag to reorder this row"
                          >
                            :: 
                          </button>
                          <span className="text-xs text-slate-500 dark:text-slate-400">{item.rowOrder || '-'}</span>
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          value={item.partNumber}
                          onChange={(event) => updateLineItem(item.id, 'partNumber', event.target.value)}
                          disabled={!canEdit}
                          className="w-40 rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-900/30"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          value={item.quantityLoose}
                          onChange={(event) => updateLineItem(item.id, 'quantityLoose', Number(event.target.value))}
                          disabled={!canEdit}
                          className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1 text-right dark:border-slate-600 dark:bg-slate-900/30"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          value={item.quantityFab}
                          onChange={(event) => updateLineItem(item.id, 'quantityFab', Number(event.target.value))}
                          disabled={!canEdit}
                          className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1 text-right dark:border-slate-600 dark:bg-slate-900/30"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          value={item.quantityNeeded}
                          onChange={(event) => updateLineItem(item.id, 'quantityNeeded', Number(event.target.value))}
                          disabled={!canEdit}
                          className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1 text-right dark:border-slate-600 dark:bg-slate-900/30"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          value={item.unitOfMeasurement || ''}
                          onChange={(event) => updateLineItem(item.id, 'unitOfMeasurement', event.target.value)}
                          disabled={!canEdit}
                          className="w-20 rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-900/30"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          value={item.description || ''}
                          onChange={(event) => updateLineItem(item.id, 'description', event.target.value)}
                          disabled={!canEdit}
                          className="min-w-[260px] rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-900/30"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200">
                          {item.reviewStatus === 'user_confirmed'
                            ? 'User edited'
                            : item.resolutionSource === 'vision'
                              ? 'Vision verified'
                              : item.resolutionSource === 'merged'
                                ? 'Auto-corrected'
                                : item.resolutionSource === 'fallback'
                                  ? 'Vision fallback'
                                  : 'Verified'}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <div className="space-y-1">
                          {item.unknownPart && (
                            <p className="text-xs text-amber-600 dark:text-amber-300">Unknown part</p>
                          )}
                          {getLineItemDisplayWarnings(item)
                            .slice(0, 3)
                            .map((warning, index) => (
                            <p key={`${item.id}-${index}`} className="text-xs text-slate-500 dark:text-slate-400">
                              {warning}
                            </p>
                            ))}
                        </div>
                      </td>
                      <td className="py-2 pl-3 pr-5 text-right">
                        <button
                          onClick={() => removeLineItem(item.id)}
                          disabled={!canEdit}
                          className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                  {resolvedLineItems.length === 0 && (
                    <tr>
                      <td colSpan={10} className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                        No resolved rows yet. Rescan the PDF or add a manual line.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          )}

          {activeTab === 'duplicates' && (
          <section className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700/50 dark:bg-slate-800/60">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Duplicate Merge Review</h2>
            {draftSnapshot.duplicateInfo?.exists ? (
              <div className="mt-4 space-y-4">
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  This import matches existing job {draftSnapshot.duplicateInfo.jobNumber} list {draftSnapshot.duplicateInfo.listNumber}.
                </p>
                {draftSnapshot.duplicateInfo.duplicateParts.map((part) => {
                  const currentDecision =
                    draftSnapshot.duplicateDecisions.find((decision) => decision.partNumber === part.partNumber) ||
                    ({ partNumber: part.partNumber, action: 'replace' } satisfies ImportDuplicateDecision);
                  return (
                    <div key={part.partNumber} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-white">{part.partNumber}</p>
                          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                            {part.description || 'No description'}
                          </p>
                          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                            Existing: {part.existingQuantityNeeded} needed / {part.existingQuantityFab} fab · Incoming: {part.incomingQuantityNeeded} needed / {part.incomingQuantityFab} fab
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {(['add', 'replace', 'skip', 'custom'] as ImportDuplicateAction[]).map((action) => (
                            <button
                              key={action}
                              type="button"
                              onClick={() =>
                                updateDuplicateDecision(
                                  part.partNumber,
                                  action,
                                  currentDecision.customQuantity || part.incomingQuantityNeeded,
                                )
                              }
                              className={`rounded-full border px-3 py-1 text-xs ${
                                currentDecision.action === action
                                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-500/10 dark:text-blue-200'
                                  : 'border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300'
                              }`}
                            >
                              {action}
                            </button>
                          ))}
                          {currentDecision.action === 'custom' && (
                            <input
                              type="number"
                              min={0}
                              value={currentDecision.customQuantity ?? part.incomingQuantityNeeded}
                              onChange={(event) =>
                                updateDuplicateDecision(
                                  part.partNumber,
                                  'custom',
                                  Number(event.target.value),
                                )
                              }
                              className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1 text-right dark:border-slate-600 dark:bg-slate-900/30"
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
                No duplicate job/list collision is currently detected for this import.
              </p>
            )}
          </section>
          )}
        </main>
      </div>
    </div>
  );
}
