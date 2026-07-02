'use client';

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import DashboardSidebar from '@/components/DashboardSidebar';
import AccessDeniedOverlay from '@/components/AccessDeniedOverlay';
import PartSearchCombobox from '@/components/PartSearchCombobox';
import UserPickerCombobox from '@/components/UserPickerCombobox';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { APP_TIME_ZONE, toDateKeyInAppTimeZone } from '@/lib/timezone';
import { formatVendorDisplay, normalizeVendorKey } from '@/lib/vendorUtils';
import { uploadNoteAttachments } from '@/lib/noteAttachmentUploadClient';

interface LineItem {
  id: string;
  partNumber: string;
  description: string;
  quantityNeeded: string;
  quantityFab: string;
  unitOfMeasurement: string;
  type: string;
  customVendor?: string; // For "Other" vendor option
}

function getTodayLocalDateString(): string {
  return toDateKeyInAppTimeZone(new Date());
}

interface AccessGrantRow {
  id: string;
  email: string;
}

function newAccessGrantRow(): AccessGrantRow {
  return {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `ag-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    email: '',
  };
}

function CreateJobPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const { canEdit, isLoading: isAuthLoading } = useAuth();
  const { hasPermission, isLoading: permissionsLoading } = usePermissions();
  const canCreateJobs = permissionsLoading ? canEdit : hasPermission('jobs.create');
  
  const [jobInfo, setJobInfo] = useState({
    jobNumber: '',
    jobName: '',
    listNumber: '',
    area: '',
    locationShipTo: '',
    stocklistDeliveryShipDate: getTodayLocalDateString(), // Default to today (local date)
    deliveryDate: '',
    listedBy: '',
    isServiceJob: false,
  });

  // Allow jobs that have no parts yet (e.g. lifts/delivery-only style jobs).
  // Parts can be added later via "Add Line".
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [initialNoteContent, setInitialNoteContent] = useState('');
  const [initialNoteFiles, setInitialNoteFiles] = useState<File[]>([]);
  const [isUploadingInitialNoteFiles, setIsUploadingInitialNoteFiles] = useState(false);

  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [loadingParts, setLoadingParts] = useState<Set<string>>(new Set());
  const debounceTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const [vendors, setVendors] = useState<string[]>([]);
  const [isLoadingVendors, setIsLoadingVendors] = useState(false);
  const [customVendors, setCustomVendors] = useState<Map<string, string>>(new Map()); // itemId -> custom vendor value
  const [users, setUsers] = useState<Array<{ email: string; name: string | null }>>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [accessGrantRows, setAccessGrantRows] = useState<AccessGrantRow[]>(() => [
    newAccessGrantRow(),
  ]);
  const firstErrorFieldRef = useRef<string | null>(null);
  /** Signed-in user is always job creator; omit from Access picker (they get Creator access automatically). */
  const creatingUserEmail = session?.user?.email?.trim() ?? '';

  const initialNoteObjectUrls = useMemo(() => {
    return initialNoteFiles.map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
  }, [initialNoteFiles]);

  useEffect(() => {
    return () => {
      initialNoteObjectUrls.forEach(({ url }) => URL.revokeObjectURL(url));
    };
  }, [initialNoteObjectUrls]);

  // Duplicate job/list detection: show modal and optionally merge or use next list
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [duplicateCheckData, setDuplicateCheckData] = useState<{
    existingJob: { jobNumber: string; jobName: string; listNumber: string; partCount: number };
    nextAvailableListNumber: string;
  } | null>(null);

  // Check authentication and permissions
  useEffect(() => {
    if (status === 'loading' || isAuthLoading || permissionsLoading) return;
    
    if (!session) {
      router.push('/login?callbackUrl=/jobs/create');
      return;
    }

  }, [session, status, isAuthLoading, permissionsLoading, router]);

  // Load vendors and users on mount
  useEffect(() => {
    const loadVendors = async () => {
      try {
        setIsLoadingVendors(true);
        const response = await fetch('/api/parts/vendors');
        if (!response.ok) {
          throw new Error('Failed to load vendors');
        }
        const data = await response.json();
        setVendors(data.vendors || []);
      } catch (err) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Error loading vendors:', err);
        }
        // Don't show error to user, just log it
      } finally {
        setIsLoadingVendors(false);
      }
    };

    const loadUsers = async () => {
      try {
        setIsLoadingUsers(true);
        const response = await fetch('/api/users/for-access');
        if (!response.ok) {
          throw new Error('Failed to load users');
        }
        const data = await response.json();
        setUsers(data.users || []);
        // Set default listedBy to current user's email
        if (session?.user?.email) {
          setJobInfo(prev => {
            // Only set if not already set
            if (!prev.listedBy) {
              return { ...prev, listedBy: session.user.email || '' };
            }
            return prev;
          });
        }
      } catch (err) {
        console.error('Error loading users:', err);
        // Don't show error to user, just log it
      } finally {
        setIsLoadingUsers(false);
      }
    };

    if (canCreateJobs) {
      loadVendors();
      loadUsers();
    }
  }, [canCreateJobs, session]);

  // Handle prefill data from PDF upload
  const prefillProcessedRef = useRef(false);
  useEffect(() => {
    // Only process prefill once, and only after users are loaded
    if (prefillProcessedRef.current || isLoadingUsers) return;

    const prefillKeyParam = searchParams?.get('prefillKey');
    const prefillParam = searchParams?.get('prefill');
    if (!prefillKeyParam && !prefillParam) return;

    try {
      let decodedData: any = null;

      if (prefillKeyParam) {
        const storedPrefill = sessionStorage.getItem(prefillKeyParam);
        if (!storedPrefill) {
          throw new Error(`Missing stored prefill data for key ${prefillKeyParam}`);
        }
        decodedData = JSON.parse(storedPrefill);
      } else if (prefillParam) {
        decodedData = JSON.parse(decodeURIComponent(prefillParam));
      }
      
      if (decodedData.jobInfo) {
        const jobInfo = decodedData.jobInfo;
        setJobInfo({
          jobNumber: jobInfo.jobNumber || '',
          jobName: jobInfo.jobName || '',
          listNumber: jobInfo.listNumber || '',
          area: jobInfo.area || '',
          locationShipTo: jobInfo.locationShipTo || '',
          stocklistDeliveryShipDate: jobInfo.stocklistDeliveryShipDate || getTodayLocalDateString(),
          deliveryDate: jobInfo.deliveryDate || getTodayLocalDateString(),
          listedBy: jobInfo.listedBy || (session?.user?.email || ''),
          isServiceJob: jobInfo.isServiceJob === true,
        });
      }

      if (decodedData.lineItems && Array.isArray(decodedData.lineItems) && decodedData.lineItems.length > 0) {
        // Convert extracted line items to form format
        const newLineItems: LineItem[] = decodedData.lineItems.map((item: any, index: number) => ({
          id: String(index + 1),
          partNumber: item.partNumber || '',
          description: item.description || '',
          quantityNeeded:
            item.quantityNeeded === undefined || item.quantityNeeded === null
              ? ''
              : String(item.quantityNeeded),
          quantityFab: String(item.quantityFab ?? 0),
          unitOfMeasurement: item.unitOfMeasurement || item.uomFromPdf || '',
          type: (item.type && typeof item.type === 'string') ? normalizeVendorKey(item.type) : '',
        }));
        setLineItems(newLineItems);
        setExpandedItems(new Set(newLineItems.map(item => item.id)));
      }

      // Set validation errors for missing required fields
      const errors: Record<string, string> = {};

      if (decodedData.missingRequiredFields && Array.isArray(decodedData.missingRequiredFields)) {
        // Job-level required fields
        const fieldPriority = ['jobNumber', 'jobName', 'listNumber', 'stocklistDeliveryShipDate', 'deliveryDate'];

        decodedData.missingRequiredFields.forEach((field: string) => {
          if (field === 'jobNumber') {
            errors.jobNumber = 'Job Number is required';
          } else if (field === 'jobName') {
            errors.jobName = 'Job Name is required';
          } else if (field === 'listNumber') {
            errors.listNumber = 'List Number is required';
          } else if (field === 'stocklistDeliveryShipDate') {
            errors.stocklistDeliveryShipDate = 'Stocklist Date is required';
          } else if (field === 'deliveryDate') {
            errors.deliveryDate = 'Delivery Date is required';
          }
        });

        // Set firstErrorFieldRef to the first job-level missing field in DOM order
        for (const fieldId of fieldPriority) {
          if (decodedData.missingRequiredFields.includes(fieldId)) {
            firstErrorFieldRef.current = fieldId;
            break;
          }
        }
      }

      // Line-item required fields (part number, quantity, vendor/type)
      if (decodedData.lineItems && Array.isArray(decodedData.lineItems)) {
        decodedData.lineItems.forEach((item: any, index: number) => {
          const id = String(index + 1);

          // Part number
          if (!item.partNumber || !String(item.partNumber).trim()) {
            errors[`${id}-partNumber`] = 'Part Number is required';
          }

          // Quantity
          if (
            item.quantityNeeded === undefined ||
            item.quantityNeeded === null ||
            String(item.quantityNeeded).trim() === ''
          ) {
            errors[`${id}-quantityNeeded`] = 'Quantity Needed is required';
          }

          // Vendor / type
          if (!item.type || !String(item.type).trim()) {
            errors[`${id}-type`] = 'Vendor is required';
          }
        });
      }

      if (Object.keys(errors).length > 0) {
        setValidationErrors(errors);
      }

      // Mark as processed
      prefillProcessedRef.current = true;

      // Clear prefill param from URL (optional, for cleaner URLs)
      const newSearchParams = new URLSearchParams(searchParams?.toString() ?? '');
      if (prefillKeyParam) {
        sessionStorage.removeItem(prefillKeyParam);
        newSearchParams.delete('prefillKey');
      }
      newSearchParams.delete('prefill');
      const newUrl = newSearchParams.toString() 
        ? `${window.location.pathname}?${newSearchParams.toString()}`
        : window.location.pathname;
      router.replace(newUrl, { scroll: false });

      // Scroll to first error field after a short delay to ensure DOM is updated
      if (firstErrorFieldRef.current) {
        setTimeout(() => {
          const fieldId = firstErrorFieldRef.current;
          if (fieldId) {
            const element = document.getElementById(fieldId);
            if (element) {
              element.scrollIntoView({ behavior: 'smooth', block: 'center' });
              element.focus();
            }
          }
        }, 100);
      }
    } catch (error) {
      console.error('Error parsing prefill data:', error);
      // Silently fail - form will just start empty
    }
  }, [searchParams, isLoadingUsers, session, router]);

  const toggleItemExpanded = (id: string) => {
    setExpandedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const addLineItem = () => {
    const newId = Date.now().toString();
    setLineItems((prev) => [
      ...prev,
      {
        id: newId,
        partNumber: '',
        description: '',
        quantityNeeded: '',
        quantityFab: '0',
        unitOfMeasurement: '',
        type: '',
      },
    ]);
    setExpandedItems((prev) => new Set([...prev, newId]));
  };

  const removeLineItem = (id: string) => {
    setLineItems((prev) => prev.filter((item) => item.id !== id));
    setExpandedItems((prev) => {
      const newSet = new Set(prev);
      newSet.delete(id);
      return newSet;
    });
    // Drop validation errors for the removed row
    setValidationErrors((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((k) => {
        if (k.startsWith(`${id}-`)) delete next[k];
      });
      return next;
    });
  };

  const addInitialNoteFiles = (files: File[]) => {
    if (files.length === 0) return;
    setInitialNoteFiles((prev) => [...prev, ...files]);
  };

  const removeInitialNoteFile = (index: number) => {
    setInitialNoteFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const updateLineItem = (id: string, field: keyof LineItem, value: string) => {
    setLineItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
    // Clear validation error for this field
    const errorKey = `${id}-${field}`;
    if (validationErrors[errorKey]) {
      setValidationErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[errorKey];
        return newErrors;
      });
    }
  };

  // Fetch part details and auto-fill fields
  const fetchPartDetails = useCallback(async (itemId: string, partNumber: string) => {
    if (!partNumber || !partNumber.trim()) {
      return;
    }

    setLoadingParts((prev) => new Set(prev).add(itemId));

    try {
      const response = await fetch(`/api/parts/details?partNumber=${encodeURIComponent(partNumber)}`);
      if (!response.ok) {
        throw new Error('Failed to fetch part details');
      }

      const data = await response.json();

      if (data.found) {
        // Auto-fill description, unitOfMeasurement, and type (normalized to lowercase)
        // User can still manually edit these fields after auto-fill
        const vendorKey = data.type ? normalizeVendorKey(data.type) : '';
        setLineItems((prev) =>
          prev.map((item) => {
            if (item.id === itemId) {
              return {
                ...item,
                description: data.description || '',
                unitOfMeasurement: data.unitOfMeasurement || '',
                type: vendorKey,
                // Keep quantityNeeded unchanged - user must enter this
              };
            }
            return item;
          })
        );
        // Clear custom vendor if it was set (in case "Other" was previously selected)
        setCustomVendors((prev) => {
          const newMap = new Map(prev);
          newMap.delete(itemId);
          return newMap;
        });
      }
    } catch (err) {
      console.error('Error fetching part details:', err);
      // Silently fail - don't show error to user
    } finally {
      setLoadingParts((prev) => {
        const newSet = new Set(prev);
        newSet.delete(itemId);
        return newSet;
      });
    }
  }, []);

  // Handle part number change with debouncing
  const handlePartNumberChange = useCallback((itemId: string, partNumber: string) => {
    // Update the part number immediately
    updateLineItem(itemId, 'partNumber', partNumber);

    // Clear existing timer for this item
    const existingTimer = debounceTimers.current.get(itemId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer to fetch part details after user stops typing
    const timer = setTimeout(() => {
      fetchPartDetails(itemId, partNumber);
      debounceTimers.current.delete(itemId);
    }, 500); // 500ms debounce

    debounceTimers.current.set(itemId, timer);
  }, [fetchPartDetails]);

  // Handle vendor selection (value is already lowercase from dropdown; "OTHER" for custom)
  const handleVendorChange = (itemId: string, value: string) => {
    const normalized = value === 'OTHER' ? value : normalizeVendorKey(value);
    updateLineItem(itemId, 'type', normalized);
    // Clear custom vendor if not "Other"
    if (value !== 'OTHER') {
      setCustomVendors((prev) => {
        const newMap = new Map(prev);
        newMap.delete(itemId);
        return newMap;
      });
    }
  };

  // Handle custom vendor input (keep item.type as 'OTHER' so the custom input stays visible)
  const handleCustomVendorChange = (itemId: string, value: string) => {
    setCustomVendors((prev) => {
      const newMap = new Map(prev);
      newMap.set(itemId, value);
      return newMap;
    });
    // Do NOT overwrite item.type - keep it as 'OTHER' so the custom input stays visible.
    // The actual custom vendor value is stored in customVendors and used when saving.
    // Clear validation error
    const errorKey = `${itemId}-type`;
    if (validationErrors[errorKey]) {
      setValidationErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[errorKey];
        return newErrors;
      });
    }
  };

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      debounceTimers.current.forEach((timer) => clearTimeout(timer));
      debounceTimers.current.clear();
    };
  }, []);

  const updateJobInfo = (field: keyof typeof jobInfo, value: string) => {
    setJobInfo((prev) => ({ ...prev, [field]: value }));
    // Clear validation error for this field
    if (validationErrors[field]) {
      setValidationErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    const trimmedJobNumber = jobInfo.jobNumber.trim();
    if (!trimmedJobNumber) {
      errors.jobNumber = 'Job Number is required';
    } else {
      if (/\s/.test(trimmedJobNumber)) {
        errors.jobNumber = 'Job Number cannot contain spaces – use the numeric job code only.';
      } else if (trimmedJobNumber.includes('%')) {
        errors.jobNumber = 'Job Number contains invalid characters (like %).';
      }
    }

    if (!jobInfo.jobName.trim()) {
      errors.jobName = 'Job Name is required';
    }

    if (!jobInfo.listNumber.trim()) {
      errors.listNumber = 'List Number is required';
    }

    if (!jobInfo.stocklistDeliveryShipDate) {
      errors.stocklistDeliveryShipDate = 'Stocklist Date is required';
    } else if (isNaN(new Date(jobInfo.stocklistDeliveryShipDate).getTime())) {
      errors.stocklistDeliveryShipDate = 'Invalid stocklist date format';
    }

    if (!jobInfo.deliveryDate) {
      errors.deliveryDate = 'Delivery Date is required';
    } else if (isNaN(new Date(jobInfo.deliveryDate).getTime())) {
      errors.deliveryDate = 'Invalid delivery date format';
    }

    const grantEmails = new Set<string>();
    for (const row of accessGrantRows) {
      const e = row.email.trim().toLowerCase();
      if (!e) continue;
      if (grantEmails.has(e)) {
        errors.accessGrants = 'Each person can only be added once';
        break;
      }
      grantEmails.add(e);
    }

    const creatorLower = creatingUserEmail.toLowerCase();
    if (creatorLower) {
      for (const row of accessGrantRows) {
        const e = row.email.trim().toLowerCase();
        if (e && e === creatorLower) {
          errors.accessGrants = 'You already have access as the job creator.';
          break;
        }
      }
    }

    // Validate line items
    lineItems.forEach((item, index) => {
      if (!item.partNumber.trim()) {
        errors[`${item.id}-partNumber`] = 'Part Number is required';
      }
      if (!item.quantityNeeded.trim()) {
        errors[`${item.id}-quantityNeeded`] = 'Quantity Needed is required';
      } else {
        const quantity = parseInt(item.quantityNeeded, 10);
        if (isNaN(quantity) || quantity < 0) {
          errors[`${item.id}-quantityNeeded`] = 'Quantity Needed must be a number >= 0';
        }
      }
      // Validate vendor - either from dropdown or custom
      if (!item.type.trim()) {
        errors[`${item.id}-type`] = 'Vendor is required';
      } else if (item.type === 'OTHER' && !customVendors.get(item.id)?.trim()) {
        errors[`${item.id}-type`] = 'Please enter a vendor name';
      }
    });

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const buildAccessGrantsPayload = (): Array<{ userEmail: string }> =>
    accessGrantRows
      .filter((row) => row.email.trim())
      .map((row) => ({
        userEmail: row.email.trim(),
      }));

  const buildCreatePayload = () => {
    const accessGrants = buildAccessGrantsPayload();
    return {
      jobNumber: jobInfo.jobNumber.trim(),
      jobName: jobInfo.jobName.trim(),
      listNumber: jobInfo.listNumber.trim() || '1',
      area: jobInfo.area.trim() || null,
      locationShipTo: jobInfo.locationShipTo.trim() || null,
      stocklistDeliveryShipDate: jobInfo.stocklistDeliveryShipDate || getTodayLocalDateString(),
      deliveryDate: jobInfo.deliveryDate,
      listedBy: jobInfo.listedBy.trim() || null,
      isServiceJob: jobInfo.isServiceJob ?? false,
      creatorTimezone: APP_TIME_ZONE,
      lineItems: lineItems.map((item) => ({
        partNumber: item.partNumber.trim(),
        description: item.description.trim() || null,
        quantityNeeded: parseInt(item.quantityNeeded, 10),
        quantityFab: parseInt(item.quantityFab || '0', 10) || 0,
        unitOfMeasurement: item.unitOfMeasurement.trim() || null,
        type: item.type === 'OTHER'
          ? (normalizeVendorKey(customVendors.get(item.id)) || null)
          : (normalizeVendorKey(item.type) || null),
      })),
      ...(accessGrants.length > 0 ? { accessGrants } : {}),
      ...(hasInitialNote()
        ? {
            initialNote: {
              content: initialNoteContent.trim(),
              hasAttachments: initialNoteFiles.length > 0,
            },
          }
        : {}),
    };
  };

  const hasInitialNote = () =>
    initialNoteContent.trim().length > 0 || initialNoteFiles.length > 0;

  const buildJobUrl = (jobNumber: string, listNumber: string, noteId?: string | null) => {
    const params = new URLSearchParams({ list: listNumber });
    if (noteId) {
      params.set('tab', 'notes');
      params.set('openNoteId', noteId);
    }
    return `/job/${encodeURIComponent(jobNumber)}?${params.toString()}`;
  };

  const createInitialNoteForJob = async (
    jobNumber: string,
    listNumber: string,
    existingNoteId?: string | null,
  ): Promise<string | null> => {
    if (!hasInitialNote()) return null;

    let noteId = existingNoteId ?? null;
    const query = new URLSearchParams({ listNumber });
    if (!noteId) {
      const notesUrl = `/api/jobs/${encodeURIComponent(jobNumber)}/notes?${query.toString()}`;
      const response = await fetch(notesUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: initialNoteContent.trim(),
          notify: false,
        }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          `Job was created, but the initial note could not be saved. Open the job here and add it from the Notes tab: ${buildJobUrl(jobNumber, listNumber)}. ${data?.error || ''}`.trim(),
        );
      }

      noteId = data?.note?.id;
      if (!noteId || typeof noteId !== 'string') {
        throw new Error(
          `Job was created, but the initial note response was missing a note id. Open the job here: ${buildJobUrl(jobNumber, listNumber)}`,
        );
      }
    }

    if (initialNoteFiles.length > 0) {
      setIsUploadingInitialNoteFiles(true);
      try {
        const uploadResult = await uploadNoteAttachments({
          jobNumber,
          listNumberContext: listNumber,
          noteId,
          files: initialNoteFiles,
        });
        if (uploadResult.failed.length > 0) {
          console.error(
            'Initial note attachment upload failures:',
            uploadResult.failed.map((f) => ({ file: f.file.name, error: f.error })),
          );
        }
      } finally {
        setIsUploadingInitialNoteFiles(false);
      }
    }

    return noteId;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setValidationErrors({});

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const listNumberToCheck = jobInfo.listNumber.trim() || '1';
      const checkRes = await fetch('/api/jobs/check-duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobNumber: jobInfo.jobNumber.trim(),
          listNumber: listNumberToCheck,
        }),
      });
      const checkData = await checkRes.json();
      if (!checkRes.ok) {
        throw new Error(checkData.error || 'Failed to check for existing job');
      }

      if (checkData.exists) {
        setDuplicateCheckData({
          existingJob: checkData.existingJob,
          nextAvailableListNumber: checkData.nextAvailableListNumber ?? '2',
        });
        setShowDuplicateModal(true);
        setIsSubmitting(false);
        return;
      }

      const payload = buildCreatePayload();
      const response = await fetch('/api/jobs/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create job');
      }

      const initialNoteId = await createInitialNoteForJob(
        payload.jobNumber,
        payload.listNumber,
        typeof data.initialNoteId === 'string' ? data.initialNoteId : null,
      );
      router.push(buildJobUrl(payload.jobNumber, payload.listNumber, initialNoteId));
    } catch (err) {
      console.error('Error creating job:', err);
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDuplicateConfirm = async (action: 'add' | 'replace') => {
    if (!duplicateCheckData?.existingJob) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const payload = buildCreatePayload();
      const listNumberForMerge = duplicateCheckData.existingJob.listNumber;
      const mergeBody: Record<string, unknown> = {
        jobNumber: payload.jobNumber,
        jobName: payload.jobName,
        listNumber: listNumberForMerge,
        contractNumber: null,
        area: payload.area,
        locationShipTo: payload.locationShipTo,
        stocklistDeliveryShipDate: payload.stocklistDeliveryShipDate,
        listedBy: payload.listedBy,
        deliveryDate: payload.deliveryDate,
        lineItems: payload.lineItems,
        duplicateAction: action,
      };
      if ('initialNote' in payload) {
        mergeBody.initialNote = (payload as { initialNote?: unknown }).initialNote;
      }
      if ('accessGrants' in payload && Array.isArray((payload as { accessGrants?: unknown }).accessGrants)) {
        mergeBody.accessGrants = (payload as { accessGrants: unknown }).accessGrants;
      }
      const response = await fetch('/api/jobs/create-with-merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mergeBody),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || data.message || 'Failed to create/update job');
      }
      setShowDuplicateModal(false);
      setDuplicateCheckData(null);
      const initialNoteId = await createInitialNoteForJob(
        payload.jobNumber,
        listNumberForMerge,
        typeof data.initialNoteId === 'string' ? data.initialNoteId : null,
      );
      router.push(buildJobUrl(payload.jobNumber, listNumberForMerge, initialNoteId));
    } catch (err) {
      console.error('Error in create-with-merge:', err);
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUseNextList = () => {
    if (!duplicateCheckData?.nextAvailableListNumber) return;
    setJobInfo((prev) => ({
      ...prev,
      listNumber: duplicateCheckData.nextAvailableListNumber,
    }));
    setShowDuplicateModal(false);
    setDuplicateCheckData(null);
  };

  if (status === 'loading' || isAuthLoading || permissionsLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-slate-700 dark:text-slate-400 font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  if (!canCreateJobs) {
    return (
      <div className="h-screen bg-gray-50 dark:bg-slate-900 flex">
        <DashboardSidebar />
        <div className="pointer-events-none flex min-w-0 flex-1 select-none flex-col gap-4 overflow-hidden p-6 blur-sm opacity-60">
          <div className="h-24 rounded-xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60" />
          <div className="flex-1 rounded-xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60" />
        </div>
        <AccessDeniedOverlay message="You do not have permission to create jobs." />
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-50 dark:bg-slate-900 flex">
      {/* Left Sidebar */}
      <DashboardSidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-white dark:bg-slate-800/60 border-b border-gray-200 dark:border-slate-700/50 flex-shrink-0">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white">
                  Create New Job
                </h1>
                <p className="text-sm text-slate-700 dark:text-slate-400 mt-1 font-medium">
                  Enter job information and line items
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => router.push('/jobs')}
                  disabled={isSubmitting || isUploadingInitialNoteFiles}
                  className="px-4 py-2 bg-gray-200 dark:bg-slate-700/50 hover:bg-gray-300 dark:hover:bg-slate-700/70 text-slate-900 dark:text-white rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="create-job-form"
                  disabled={isSubmitting || isUploadingInitialNoteFiles}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      {isUploadingInitialNoteFiles ? 'Uploading note files...' : 'Creating...'}
                    </>
                  ) : (
                    'Create Job'
                  )}
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Error Banner */}
        {error && (
          <div className="px-6 pt-4 flex-shrink-0">
            <div className="bg-red-500 text-white p-4 rounded-xl shadow-lg">
              <p className="font-bold">Error: {error}</p>
            </div>
          </div>
        )}

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto xl:overflow-hidden px-6 py-6 bg-gray-50 dark:bg-slate-900">
          <form id="create-job-form" onSubmit={handleSubmit} className="min-h-full xl:h-full flex flex-col">
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.05fr)_minmax(520px,1fr)] gap-6 xl:flex-1 xl:min-h-0">
              <div className="space-y-6 xl:overflow-y-auto xl:pr-1 xl:min-h-0">
                <section className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 rounded-xl p-6 shadow-sm">
                  <div className="mb-5 pb-3 border-b border-gray-200 dark:border-slate-700/50">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                      Job Information
                    </h2>
                    <p className="mt-1 text-sm font-medium text-slate-600 dark:text-slate-400">
                      Core job details, dates, and jobsite location.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="jobNumber" className="block text-sm font-bold text-slate-900 dark:text-slate-300 mb-2">
                    Job Number <span className="text-red-500 dark:text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    id="jobNumber"
                    value={jobInfo.jobNumber}
                    onChange={(e) => updateJobInfo('jobNumber', e.target.value)}
                    required
                    className={`w-full px-4 py-2.5 bg-white dark:bg-slate-800/80 border rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-500 shadow-sm transition-all ${
                      validationErrors.jobNumber
                        ? 'border-red-500'
                        : 'border-gray-300 dark:border-slate-600/80 hover:border-gray-400 dark:hover:border-slate-500/80'
                    }`}
                    placeholder="e.g., 25-1379"
                  />
                  {validationErrors.jobNumber && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{validationErrors.jobNumber}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="jobName" className="block text-sm font-bold text-slate-900 dark:text-slate-300 mb-2">
                    Job Name <span className="text-red-500 dark:text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    id="jobName"
                    value={jobInfo.jobName}
                    onChange={(e) => updateJobInfo('jobName', e.target.value)}
                    required
                    className={`w-full px-4 py-2.5 bg-white dark:bg-slate-800/80 border rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-500 shadow-sm transition-all ${
                      validationErrors.jobName
                        ? 'border-red-500'
                        : 'border-gray-300 dark:border-slate-600/80 hover:border-gray-400 dark:hover:border-slate-500/80'
                    }`}
                    placeholder="e.g., Office Building Project"
                  />
                  {validationErrors.jobName && (
                    <p className="mt-1 text-sm text-red-400">{validationErrors.jobName}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="listNumber" className="block text-sm font-bold text-slate-900 dark:text-slate-300 mb-2">
                    List Number <span className="text-red-500 dark:text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    id="listNumber"
                    value={jobInfo.listNumber}
                    onChange={(e) => updateJobInfo('listNumber', e.target.value)}
                    required
                    className={`w-full px-4 py-2.5 bg-white dark:bg-slate-800/80 border rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-500 shadow-sm transition-all ${
                      validationErrors.listNumber
                        ? 'border-red-500'
                        : 'border-gray-300 dark:border-slate-600/80 hover:border-gray-400 dark:hover:border-slate-500/80'
                    }`}
                    placeholder="e.g. 1"
                  />
                  {validationErrors.listNumber && (
                    <p className="mt-1 text-sm text-red-400">{validationErrors.listNumber}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="stocklistDeliveryShipDate" className="block text-sm font-bold text-slate-900 dark:text-slate-300 mb-2">
                    Stocklist Date <span className="text-red-500 dark:text-red-400">*</span>
                  </label>
                  <input
                    type="date"
                    id="stocklistDeliveryShipDate"
                    value={jobInfo.stocklistDeliveryShipDate}
                    onChange={(e) => updateJobInfo('stocklistDeliveryShipDate', e.target.value)}
                    required
                    className={`w-full px-4 py-2.5 bg-white dark:bg-slate-800/80 border rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-500 shadow-sm transition-all dark:[&::-webkit-calendar-picker-indicator]:invert ${
                      validationErrors.stocklistDeliveryShipDate
                        ? 'border-red-500'
                        : 'border-gray-300 dark:border-slate-600/80 hover:border-gray-400 dark:hover:border-slate-500/80'
                    }`}
                  />
                  {validationErrors.stocklistDeliveryShipDate && (
                    <p className="mt-1 text-sm text-red-400">{validationErrors.stocklistDeliveryShipDate}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="listedBy" className="block text-sm font-bold text-slate-900 dark:text-slate-300 mb-2">
                    Listed By
                  </label>
                  <div className="relative">
                    <select
                      id="listedBy"
                      value={jobInfo.listedBy}
                      onChange={(e) => updateJobInfo('listedBy', e.target.value)}
                      className="w-full pl-4 pr-10 py-2.5 bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-600/80 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white shadow-sm hover:border-gray-400 dark:hover:border-slate-500/80 transition-all appearance-none"
                    >
                      <option value="">Select a user...</option>
                      {isLoadingUsers ? (
                        <option value="" disabled>Loading users...</option>
                      ) : (
                        users.map((user) => (
                          <option key={user.email} value={user.email} className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                            {user.name || user.email}
                          </option>
                        ))
                      )}
                    </select>
                    <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-slate-500 dark:text-white flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="create-job-service-job"
                    checked={jobInfo.isServiceJob ?? false}
                    onChange={() => setJobInfo((prev) => ({ ...prev, isServiceJob: !prev.isServiceJob }))}
                    className="h-4 w-4 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 bg-white dark:bg-slate-800"
                  />
                  <label
                    htmlFor="create-job-service-job"
                    className="text-sm font-bold text-slate-600 dark:text-slate-300 cursor-pointer select-none"
                  >
                    Service job
                  </label>
                </div>

                <div>
                  <label htmlFor="area" className="block text-sm font-bold text-slate-900 dark:text-slate-300 mb-2">
                    Area
                  </label>
                  <input
                    type="text"
                    id="area"
                    value={jobInfo.area}
                    onChange={(e) => updateJobInfo('area', e.target.value)}
                    className="w-full px-4 py-2.5 bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-600/80 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-500 shadow-sm hover:border-gray-400 dark:hover:border-slate-500/80 transition-all"
                    placeholder="Optional"
                  />
                </div>

                <div>
                  <label htmlFor="locationShipTo" className="block text-sm font-bold text-slate-900 dark:text-slate-300 mb-2">
                    Location / Ship To
                  </label>
                  <input
                    type="text"
                    id="locationShipTo"
                    value={jobInfo.locationShipTo}
                    onChange={(e) => updateJobInfo('locationShipTo', e.target.value)}
                    className="w-full px-4 py-2.5 bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-600/80 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-500 shadow-sm hover:border-gray-400 dark:hover:border-slate-500/80 transition-all"
                    placeholder="Optional"
                  />
                </div>

                <div>
                  <label htmlFor="deliveryDate" className="block text-sm font-bold text-slate-900 dark:text-slate-300 mb-2">
                      Delivery Date <span className="text-red-500 dark:text-red-400">*</span>
                    </label>
                    <input
                      type="date"
                      id="deliveryDate"
                      value={jobInfo.deliveryDate}
                      onChange={(e) => updateJobInfo('deliveryDate', e.target.value)}
                      required
                      className={`w-full px-4 py-2.5 bg-white dark:bg-slate-800/80 border rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-500 shadow-sm transition-all dark:[&::-webkit-calendar-picker-indicator]:invert ${
                        validationErrors.deliveryDate
                          ? 'border-red-500'
                          : 'border-gray-300 dark:border-slate-600/80 hover:border-gray-400 dark:hover:border-slate-500/80'
                      }`}
                    />
                    {validationErrors.deliveryDate && (
                      <p className="mt-1 text-sm text-red-400">{validationErrors.deliveryDate}</p>
                    )}
                </div>

                  </div>
                </section>

                <section className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 rounded-xl p-6 shadow-sm">
                  <div className="mb-5 pb-3 border-b border-gray-200 dark:border-slate-700/50">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                      Job Notes
                    </h2>
                    <p className="mt-1 text-sm font-medium text-slate-600 dark:text-slate-400">
                      Optional access notes, instructions, photos, and PDFs.
                    </p>
                  </div>
                  <textarea
                    value={initialNoteContent}
                    onChange={(e) => setInitialNoteContent(e.target.value)}
                    rows={4}
                    className="w-full px-4 py-3 bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-600/80 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-500 shadow-sm hover:border-gray-400 dark:hover:border-slate-500/80 transition-all resize-none"
                    placeholder="Access notes, jobsite instructions, gate codes, contact details..."
                    disabled={isSubmitting}
                  />
                  <div
                    onDragEnter={(e) => {
                      e.preventDefault();
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (isSubmitting) return;
                      addInitialNoteFiles(Array.from(e.dataTransfer.files || []));
                    }}
                    className="mt-3 rounded-xl border-2 border-dashed border-gray-300 dark:border-slate-600/50 bg-gray-50 dark:bg-slate-700/30 p-4"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <p className="text-xs text-slate-600 dark:text-slate-400 flex-1">
                        Drag files here, or upload photos and PDFs.
                      </p>
                      <label className={`w-full sm:w-auto px-4 py-2 bg-gray-100 dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-700 dark:text-slate-200 rounded-xl font-semibold hover:bg-gray-200 dark:hover:bg-slate-700/70 hover:text-slate-900 dark:hover:text-white transition-all text-center ${isSubmitting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                        Upload
                        <input
                          type="file"
                          multiple
                          className="sr-only"
                          disabled={isSubmitting}
                          onChange={(e) => {
                            const files = Array.from(e.target.files || []);
                            e.currentTarget.value = '';
                            addInitialNoteFiles(files);
                          }}
                        />
                      </label>
                    </div>
                  </div>
                  {initialNoteFiles.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                          {initialNoteFiles.length} file{initialNoteFiles.length === 1 ? '' : 's'} selected
                        </p>
                        <button
                          type="button"
                          onClick={() => setInitialNoteFiles([])}
                          disabled={isSubmitting}
                          className="text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-all disabled:opacity-50"
                        >
                          Clear
                        </button>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {initialNoteObjectUrls.map(({ file, url }, index) => {
                          const isImage = file.type.startsWith('image/');
                          const isPdf = file.type === 'application/pdf';
                          return (
                            <div
                              key={`${file.name}-${file.lastModified}-${file.size}-${index}`}
                              className="rounded-lg overflow-hidden border border-gray-300 dark:border-slate-600/50 bg-white dark:bg-slate-800/70"
                            >
                              {isImage ? (
                                <img src={url} alt={file.name} className="w-full h-24 object-cover" />
                              ) : (
                                <div className="h-24 flex items-center justify-center bg-gray-100 dark:bg-slate-700/50">
                                  <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                                    {isPdf ? 'PDF' : 'FILE'}
                                  </span>
                                </div>
                              )}
                              <div className="px-2 py-1 flex items-center gap-2">
                                <p className="min-w-0 flex-1 text-[10px] text-slate-600 dark:text-slate-400 truncate">
                                  {file.name}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => removeInitialNoteFile(index)}
                                  disabled={isSubmitting}
                                  className="text-[10px] font-semibold text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 disabled:opacity-50"
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
                </section>

                <section className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 rounded-xl p-6 shadow-sm">
                  <div className="mb-5 pb-3 border-b border-gray-200 dark:border-slate-700/50">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                      Access
                    </h2>
                    <p className="mt-1 text-sm font-medium text-slate-600 dark:text-slate-400">
                      Add people who should receive job access and notifications.
                    </p>
                  </div>
                  {validationErrors.accessGrants && (
                    <p className="mb-2 text-sm text-red-600 dark:text-red-400">
                      {validationErrors.accessGrants}
                    </p>
                  )}
                  <div className="space-y-3">
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
                        className="flex flex-col sm:flex-row sm:items-end gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <label
                            className="block text-xs font-bold text-slate-700 dark:text-slate-400 mb-1.5"
                            htmlFor={`access-grant-user-${row.id}`}
                          >
                            User
                          </label>
                          <UserPickerCombobox
                            id={`access-grant-user-${row.id}`}
                            users={users}
                            value={row.email}
                            onChange={(email) =>
                              setAccessGrantRows((prev) =>
                                prev.map((r) => (r.id === row.id ? { ...r, email } : r)),
                              )
                            }
                            excludedEmails={excludedEmails}
                            disabled={isLoadingUsers}
                            placeholder={
                              isLoadingUsers ? 'Loading users…' : 'Search by name or email…'
                            }
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setAccessGrantRows((prev) => {
                              const next = prev.filter((r) => r.id !== row.id);
                              return next.length > 0 ? next : [newAccessGrantRow()];
                            })
                          }
                          className="sm:mb-0.5 px-3 py-2 text-sm font-semibold text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors self-start sm:self-auto"
                        >
                          Remove
                        </button>
                      </div>
                    );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setAccessGrantRows((prev) => [...prev, newAccessGrantRow()])
                    }
                    className="mt-3 px-3 py-2 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                  >
                    + Add person
                  </button>
                </section>
              </div>

              {/* Right Card: Line Items */}
              <div className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 rounded-xl p-6 flex flex-col overflow-hidden shadow-sm min-h-[420px] xl:min-h-0">
                <div className="flex items-center justify-between mb-6 pb-2 border-b border-gray-200 dark:border-slate-700/50 flex-shrink-0">
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                    Line Items <span className="text-sm font-normal text-slate-600 dark:text-slate-400">({lineItems.length})</span>
                  </h2>
                  <button
                    type="button"
                    onClick={addLineItem}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-all flex items-center gap-1.5"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Item
                  </button>
                </div>

                <div className="space-y-3 overflow-y-auto flex-1 pr-2 -mr-2">
                {lineItems.map((item, index) => {
                  const isExpanded = expandedItems.has(item.id);
                  const hasMultipleItems = lineItems.length > 1;

                  return (
                    <div
                      key={item.id}
                      className="bg-gray-50 dark:bg-slate-700/30 border border-gray-200 dark:border-slate-600/50 rounded-xl overflow-hidden"
                    >
                      {/* Item Header - Collapsible */}
                      {hasMultipleItems && (
                        <button
                          type="button"
                          onClick={() => toggleItemExpanded(item.id)}
                          className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-slate-700/50 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">#{index + 1}</span>
                            <span className="text-slate-900 dark:text-white font-medium">
                              {item.partNumber || 'New Item'}
                            </span>
                            {item.quantityNeeded && (
                              <span className="text-sm text-slate-600 dark:text-slate-400">
                                Qty: {item.quantityNeeded}
                              </span>
                            )}
                            {item.quantityFab && item.quantityFab !== '0' && (
                              <span className="text-sm text-slate-600 dark:text-slate-400">
                                FAB: {item.quantityFab}
                              </span>
                            )}
                          </div>
                          <svg
                            className={`w-5 h-5 text-slate-600 dark:text-slate-400 transition-transform ${
                              isExpanded ? 'rotate-180' : ''
                            }`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 9l-7 7-7-7"
                            />
                          </svg>
                        </button>
                      )}

                      {/* Item Content */}
                      {(isExpanded || !hasMultipleItems) && (
                        <div className="p-4 space-y-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-semibold text-slate-900 dark:text-slate-300">
                              Item #{index + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeLineItem(item.id)}
                              className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm font-medium transition-colors"
                            >
                              Remove
                            </button>
                          </div>

                          <div>
                            <label className="block text-sm font-bold text-slate-900 dark:text-slate-300 mb-2">
                              Part Number <span className="text-red-500 dark:text-red-400">*</span>
                            </label>
                            <PartSearchCombobox
                              value={item.partNumber}
                              onChange={(v) => handlePartNumberChange(item.id, v)}
                              onPartSelect={(part) => {
                                handlePartNumberChange(item.id, part.pn);
                                fetchPartDetails(item.id, part.pn);
                              }}
                              onBlur={() => {
                                if (item.partNumber.trim()) fetchPartDetails(item.id, item.partNumber);
                              }}
                              placeholder="Search by part number or description..."
                              required
                              error={!!validationErrors[`${item.id}-partNumber`]}
                              showLoadingIndicator={loadingParts.has(item.id)}
                            />
                            {validationErrors[`${item.id}-partNumber`] && (
                              <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                                {validationErrors[`${item.id}-partNumber`]}
                              </p>
                            )}
                          </div>

                          <div>
                            <label className="block text-sm font-bold text-slate-900 dark:text-slate-300 mb-2">
                              Description
                            </label>
                            <textarea
                              value={item.description}
                              onChange={(e) => updateLineItem(item.id, 'description', e.target.value)}
                              rows={2}
                              className="w-full px-4 py-2.5 bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-600/80 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-500 shadow-sm hover:border-gray-400 dark:hover:border-slate-500/80 transition-all resize-none"
                              placeholder="Optional description"
                            />
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-bold text-slate-900 dark:text-slate-300 mb-2">
                                Quantity Needed <span className="text-red-500 dark:text-red-400">*</span>
                              </label>
                              <input
                                type="number"
                                value={item.quantityNeeded}
                                onChange={(e) => updateLineItem(item.id, 'quantityNeeded', e.target.value)}
                                required
                                min="0"
                                className={`w-full px-4 py-2.5 bg-white dark:bg-slate-800/80 border rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-500 shadow-sm transition-all ${
                                  validationErrors[`${item.id}-quantityNeeded`]
                                    ? 'border-red-500'
                                    : 'border-gray-300 dark:border-slate-600/80 hover:border-gray-400 dark:hover:border-slate-500/80'
                                }`}
                                placeholder="0"
                              />
                              {validationErrors[`${item.id}-quantityNeeded`] && (
                                <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                                  {validationErrors[`${item.id}-quantityNeeded`]}
                                </p>
                              )}
                            </div>

                            <div>
                              <label className="block text-sm font-bold text-slate-900 dark:text-slate-300 mb-2">
                                Quantity FAB
                              </label>
                              <input
                                type="number"
                                value={item.quantityFab}
                                onChange={(e) => updateLineItem(item.id, 'quantityFab', e.target.value)}
                                min="0"
                                className="w-full px-4 py-2.5 bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-600/80 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-500 shadow-sm hover:border-gray-400 dark:hover:border-slate-500/80 transition-all"
                                placeholder="0"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-sm font-bold text-slate-900 dark:text-slate-300 mb-2">
                              Unit of Measurement
                            </label>
                            <input
                              type="text"
                              value={item.unitOfMeasurement}
                              onChange={(e) => updateLineItem(item.id, 'unitOfMeasurement', e.target.value)}
                              className="w-full px-4 py-2.5 bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-600/80 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-500 shadow-sm hover:border-gray-400 dark:hover:border-slate-500/80 transition-all"
                              placeholder="e.g., EA, FT, LB"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-bold text-slate-900 dark:text-slate-300 mb-2">
                              Vendor <span className="text-red-500 dark:text-red-400">*</span>
                            </label>
                            <div className="relative">
                              <select
                                value={item.type === 'OTHER' ? 'OTHER' : (vendors.includes(normalizeVendorKey(item.type)) ? normalizeVendorKey(item.type) : 'OTHER')}
                                onChange={(e) => handleVendorChange(item.id, e.target.value)}
                                required
                                className="w-full pl-4 pr-10 py-2.5 bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-600/80 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white shadow-sm hover:border-gray-400 dark:hover:border-slate-500/80 transition-all appearance-none"
                              >
                                <option value="">Select a vendor...</option>
                                {isLoadingVendors ? (
                                  <option value="" disabled>Loading vendors...</option>
                                ) : (
                                  <>
                                    {vendors.map((vendor) => (
                                      <option key={vendor} value={vendor} className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                                        {formatVendorDisplay(vendor)}
                                      </option>
                                    ))}
                                    <option value="OTHER" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">Other</option>
                                  </>
                                )}
                              </select>
                              <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-slate-500 dark:text-white flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>
                            {item.type === 'OTHER' && (
                              <input
                                type="text"
                                value={customVendors.get(item.id) || ''}
                                onChange={(e) => handleCustomVendorChange(item.id, e.target.value)}
                                placeholder="Enter vendor name..."
                                required
                                className="w-full mt-2 px-4 py-2.5 bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-600/80 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-500 shadow-sm hover:border-gray-400 dark:hover:border-slate-500/80 transition-all"
                              />
                            )}
                            {validationErrors[`${item.id}-type`] && (
                              <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                                {validationErrors[`${item.id}-type`]}
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                </div>
              </div>
            </div>
          </form>
        </main>
      </div>

      {/* Duplicate job/list confirmation modal */}
      {showDuplicateModal && duplicateCheckData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[10000] p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
              Job already exists
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              <strong>{duplicateCheckData.existingJob.jobNumber}</strong> – List {duplicateCheckData.existingJob.listNumber} already exists
              {duplicateCheckData.existingJob.partCount > 0 && (
                <> ({duplicateCheckData.existingJob.partCount} part{duplicateCheckData.existingJob.partCount === 1 ? '' : 's'})</>
              )}.
              How do you want to proceed?
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => handleDuplicateConfirm('add')}
                disabled={isSubmitting}
                className="w-full px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold"
              >
                {isSubmitting ? 'Processing…' : 'Merge (add new parts to existing list)'}
              </button>
              <button
                type="button"
                onClick={() => handleDuplicateConfirm('replace')}
                disabled={isSubmitting}
                className="w-full px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-semibold"
              >
                Replace (overwrite existing list with new parts)
              </button>
              {!jobInfo.listNumber.trim() && duplicateCheckData.nextAvailableListNumber && (
                <button
                  type="button"
                  onClick={handleUseNextList}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-600 dark:hover:bg-slate-500 text-slate-800 dark:text-slate-100 font-semibold"
                >
                  Create as new list (List {duplicateCheckData.nextAvailableListNumber})
                </button>
              )}
              <button
                type="button"
                onClick={() => { setShowDuplicateModal(false); setDuplicateCheckData(null); }}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-semibold"
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

export default function CreateJobPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="text-slate-900 dark:text-white text-lg">Loading...</div>
      </div>
    }>
      <CreateJobPageContent />
    </Suspense>
  );
}
