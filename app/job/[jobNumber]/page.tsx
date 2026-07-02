"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, usePathname, useSearchParams, useRouter } from "next/navigation";
import JobSummary from "@/components/JobSummary";
import JobItemsTable from "@/components/JobItemsTable";
import DeliveryTab from "@/components/DeliveryTab";
import JobPreorderTab from "@/components/JobPreorderTab";
import JobStockBackTab from "@/components/JobStockBackTab";
import PurchaseOrderTab from "@/components/PurchaseOrderTab";
import NotesTab from "@/components/NotesTab";
import AccessTab from "@/components/AccessTab";
import DashboardSidebar from "@/components/DashboardSidebar";
import AccessDeniedOverlay from "@/components/AccessDeniedOverlay";
import PartSearchCombobox from "@/components/PartSearchCombobox";
import JobPdfUpdateImportLauncher from "@/components/JobPdfUpdateImportLauncher";
import JobListSwitcher from "@/components/JobListSwitcher";
import { useAuth } from "@/lib/hooks/useAuth";
import { usePermissions } from "@/lib/hooks/usePermissions";
import { canAccessJobDirectory, type PermissionKey } from "@/lib/permissionCatalog";
import type {
  JobInfo,
  JobLineItem,
  JobMetadata,
  JobListResponse,
  JobDetailsResponse,
  UpdateJobResponse,
  BatchUpdateRequest,
  LineItemUpdate,
} from "@/lib/types";
import {
  getRemainingForItem,
  hasFab,
  hasOpenJobPreorder,
  hasShopPull,
  isOrdered,
  isReceived,
  type LineFilter,
  type PreorderTotalsForItem,
} from "@/lib/jobSummaryUtils";
import { jobPreorderPartKey } from "@/lib/jobPartKey";
import type { DeliveryRecord } from "@/lib/deliveryTypes";
import { formatVendorDisplay, normalizeVendorKey } from "@/lib/vendorUtils";
import { JOB_UPDATED_NOTIFICATION_SOURCE_OVERVIEW_EDIT } from "@/lib/notifications";
import { isJobPreorderEnabled } from "@/lib/featureFlags";

type JobDetailTab =
  | "puller"
  | "delivery"
  | "preorder"
  | "stock-back"
  | "purchase-order"
  | "notes"
  | "access";

type TabSaveHandler = (opts?: { silent?: boolean }) => Promise<boolean>;

type LiveViewer = {
  userId: string;
  userEmail: string;
  userName: string | null;
  lastSeenAt: string;
  isCurrentUser: boolean;
};

type JobTypeAccessReviewUser = {
  email: string;
  name: string | null;
  role: string | null;
  source: string;
};

type JobTypeAccessReview = {
  autoRemoved: JobTypeAccessReviewUser[];
  autoAdded: JobTypeAccessReviewUser[];
  manualMismatches: JobTypeAccessReviewUser[];
  editorWouldLoseAccess: boolean;
};

type JobTypeAccessReviewError = Error & {
  accessReview?: JobTypeAccessReview;
  canConfirm?: boolean;
  code?: string;
};

const LIST_CONTEXT_ALL = "__ALL__";
const LIVE_VIEW_POLL_INTERVAL_MS = 15000;
const jobPreorderFeaturesEnabled = isJobPreorderEnabled();

function JobPageBootLoader({ message }: { message: string }) {
  return (
    <div className="text-center">
      <div className="relative">
        <div className="absolute inset-0 bg-blue-500 rounded-full opacity-20 animate-ping" />
        <img
          src="/icon.png"
          alt="Total Fire Protection"
          className="relative z-10 mx-auto h-24 w-24 animate-float rounded-2xl shadow-lg"
        />
      </div>
      <p className="mt-8 text-2xl font-bold text-slate-900 dark:text-white">
        Total Fire Protection
      </p>
      <p className="mt-3 text-lg font-semibold text-slate-500 dark:text-slate-400">
        {message}
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <div
          className="h-2 w-2 animate-bounce rounded-full bg-blue-400"
          style={{ animationDelay: "0ms" }}
        />
        <div
          className="h-2 w-2 animate-bounce rounded-full bg-green-400"
          style={{ animationDelay: "150ms" }}
        />
        <div
          className="h-2 w-2 animate-bounce rounded-full bg-yellow-400"
          style={{ animationDelay: "300ms" }}
        />
      </div>
    </div>
  );
}

export default function JobDetailPage() {
  const params = useParams();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const jobNumber = params?.jobNumber as string;
  const listParam = searchParams?.get("list") ?? null;
  const urlTab = searchParams?.get("tab") ?? null;
  // Emails use openNoteId; older links may use noteId.
  const urlNoteId =
    searchParams?.get("openNoteId") ?? searchParams?.get("noteId") ?? null;
  const listNumberContext = useMemo(
    () =>
      listParam && listParam.trim().length > 0
        ? listParam.trim()
        : LIST_CONTEXT_ALL,
    [listParam],
  );

  // Auth
  const {
    canEdit,
    isLoading: isAuthLoading,
    isAdmin,
    canEditOverviewTab,
  } = useAuth();
  const {
    hasPermission,
    permissions,
    isLoading: permissionsLoading,
    refresh: refreshPermissions,
  } = usePermissions({ jobNumber, listNumber: listNumberContext });
  const canUsePermission = (key: PermissionKey, fallback = canEditOverviewTab) =>
    permissionsLoading ? fallback : hasPermission(key);
  const canViewJobs = permissionsLoading
    ? canEditOverviewTab
    : canAccessJobDirectory(permissions);
  const canAccessPullerTab = canViewJobs && canUsePermission("job.puller.view", false);
  const canAccessDeliveryTab = canViewJobs && canUsePermission("job.delivery.view", false);
  const canEditDeliveryDetails = canUsePermission("job.delivery.edit");
  const canMarkDelivered = canUsePermission("job.delivery.mark_delivered", false);
  const canMarkPickup = canUsePermission("job.delivery.mark_pickup", false);
  const canRecordPartialDelivery = canUsePermission("job.delivery.partial_delivery", false);
  const canAccessPreorderTab =
    canViewJobs &&
    jobPreorderFeaturesEnabled &&
    canUsePermission("job.preorder.view", false);
  const canEditPreorder =
    canUsePermission("job.preorder.edit", false) ||
    canUsePermission("job.preorder.receive", false) ||
    canUsePermission("job.preorder.undo_receive", false);
  const canAccessStockBackTab =
    canViewJobs && canUsePermission("job.stock_back.view", false);
  const canCreateStockIn = canUsePermission("job.stock_back.create", false);
  const canUndoStockIn = canUsePermission("job.stock_back.undo", false);
  const canAccessNotesTab = canViewJobs && canUsePermission("job.notes.view", false);
  const canAddEditNotes = canUsePermission("job.notes.add", false);
  const canDeleteNotes = canUsePermission("job.notes.delete", false);
  const canUploadPackingSlips = canUsePermission("job.notes.upload_packing_slips", false);
  const canAccessAccessTab = canViewJobs && canUsePermission("job.access.view", false);
  const canManageJobAccess = canUsePermission("job.access.manage", false);
  const canEditJobInfo = canUsePermission("jobs.edit_metadata");
  const canPullFromShop = canUsePermission("job.puller.pull_from_shop");
  const canOrderLineItems = canUsePermission("job.puller.order");
  const canEditLineItems = canUsePermission("job.puller.edit_line");
  const canAddLineItems = canUsePermission("job.puller.add_line");
  const canDeleteLineItems = canUsePermission("job.puller.delete_line", isAdmin);
  const canImportUpdatePdf = canUsePermission("job.puller.import_update_pdf");
  const canDeleteJobs = canUsePermission("jobs.delete", isAdmin);
  const canEditPurchaseOrderUnitCost = canUsePermission(
    "job.purchase_order.edit_unit_cost",
    isAdmin,
  );
  const canUseOverviewActions =
    canEditJobInfo ||
    canPullFromShop ||
    canOrderLineItems ||
    canEditLineItems ||
    canAddLineItems ||
    canDeleteLineItems ||
    canDeleteJobs;
  const requestedTab = useMemo<JobDetailTab | null>(() => {
    switch (urlTab) {
      case "puller":
      case "delivery":
      case "preorder":
      case "stock-back":
      case "purchase-order":
      case "notes":
      case "access":
        return urlTab;
      default:
        return null;
    }
  }, [urlTab]);

  // State
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [selectedJobNumber, setSelectedJobNumber] = useState<string | null>(
    jobNumber || null,
  );
  const [lineItems, setLineItems] = useState<JobLineItem[]>([]);
  const [currentJobName, setCurrentJobName] = useState<string>("");
  const [jobMeta, setJobMeta] = useState<JobMetadata | null>(null);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [lineFilter, setLineFilter] = useState<LineFilter>("all");
  const [showOnlyReceived, setShowOnlyReceived] = useState(false);
  const [jobPreorderPoolAvailable, setJobPreorderPoolAvailable] = useState<
    ReadonlyMap<string, number>
  >(() => new Map());
  const [jobPreorderOpenByPart, setJobPreorderOpenByPart] = useState<
    ReadonlyMap<string, number>
  >(() => new Map());

  // When list param is present, show only that list's line items; otherwise show all
  const displayedLineItems = useMemo(() => {
    if (!listParam || listParam.trim() === "") return lineItems;
    return lineItems.filter(
      (item) => (item.listNumber ?? "1") === listParam.trim(),
    );
  }, [lineItems, listParam]);
  const deliveryListContext = useMemo(() => {
    if (listParam && listParam.trim().length > 0) {
      return listParam.trim();
    }
    if (
      listNumberContext &&
      listNumberContext !== LIST_CONTEXT_ALL &&
      listNumberContext.trim().length > 0
    ) {
      return listNumberContext.trim();
    }
    const firstListNumber = displayedLineItems[0]?.listNumber;
    if (typeof firstListNumber === "string" && firstListNumber.trim().length > 0) {
      return firstListNumber.trim();
    }
    return null;
  }, [displayedLineItems, listNumberContext, listParam]);
  const currentListNumber = useMemo(() => {
    if (listParam && listParam.trim().length > 0) {
      return listParam.trim();
    }
    const selectedJob = jobs.find((j) => j.jobNumber === selectedJobNumber);
    return (
      displayedLineItems[0]?.listNumber ??
      jobMeta?.listNumber ??
      selectedJob?.listNumbers?.[0] ??
      null
    );
  }, [
    displayedLineItems,
    jobMeta?.listNumber,
    jobs,
    listParam,
    selectedJobNumber,
  ]);

  const getPreorderTotalsFor = useCallback(
    (item: JobLineItem): PreorderTotalsForItem | undefined => {
      if (!jobPreorderFeaturesEnabled) {
        return { pulled: 0, open: 0 };
      }
      const partKey = jobPreorderPartKey(item.partNumber);
      return {
        pulled: item.quantityPulledFromPreorder ?? item.quantityPreordered ?? 0,
        open: jobPreorderOpenByPart.get(partKey),
      };
    },
    [jobPreorderOpenByPart],
  );

  // Apply high-level line filter for Overview/Puller context
  const filteredLineItems = useMemo(() => {
    if (lineFilter === "all") return displayedLineItems;
    if (lineFilter === "pulled") {
      return displayedLineItems.filter((item) => hasShopPull(item));
    }
    if (lineFilter === "ordered") {
      const ordered = displayedLineItems.filter(
        (item) =>
          isOrdered(item) || hasOpenJobPreorder(getPreorderTotalsFor(item)),
      );
      if (showOnlyReceived) {
        return ordered.filter((item) => isReceived(item));
      }
      return ordered;
    }
    if (lineFilter === "fab") {
      return displayedLineItems.filter((item) => hasFab(item));
    }
    if (lineFilter === "remaining") {
      return displayedLineItems.filter(
        (item) => getRemainingForItem(item, getPreorderTotalsFor(item)) > 0,
      );
    }
    return displayedLineItems;
  }, [
    displayedLineItems,
    lineFilter,
    showOnlyReceived,
    getPreorderTotalsFor,
  ]);

  const [showUnpulledOnly, setShowUnpulledOnly] = useState(false);
  const [isLoadingJobs, setIsLoadingJobs] = useState(true);
  const [isLoadingLineItems, setIsLoadingLineItems] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobAccessDenied, setJobAccessDenied] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [hasDeliveryUnsavedChanges, setHasDeliveryUnsavedChanges] =
    useState(false);
  const [liveViewers, setLiveViewers] = useState<LiveViewer[]>([]);
  const [liveStatusError, setLiveStatusError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<JobDetailTab>("puller");
  const [showUnsavedOverviewModal, setShowUnsavedOverviewModal] =
    useState(false);
  const [pendingTabChange, setPendingTabChange] = useState<JobDetailTab | null>(
    null,
  );
  const [pendingRouteChange, setPendingRouteChange] = useState<string | null>(
    null,
  );
  const [pendingBrowserBack, setPendingBrowserBack] = useState(false);
  const pendingOverviewActionRef = useRef<(() => void) | null>(null);
  /** After email deep-link opens Notes once, do not force Notes again on tab changes. */
  const notesDeepLinkAppliedRef = useRef(false);
  const [pendingOverviewActionLabel, setPendingOverviewActionLabel] =
    useState<string | null>(null);
  const [overviewDiscardSignal, setOverviewDiscardSignal] = useState(0);
  const [isSavingBeforeLeave, setIsSavingBeforeLeave] = useState(false);
  const [tabSaveHandler, setTabSaveHandler] = useState<TabSaveHandler | null>(
    null,
  );
  const pullerScrollRef = useRef<HTMLDivElement | null>(null);
  const liveSessionIdRef = useRef<string | null>(null);
  const allowNextPopRef = useRef(false);
  const hasPushedGuardStateRef = useRef(false);
  const [showAddLineModal, setShowAddLineModal] = useState(false);
  const [isAddingLine, setIsAddingLine] = useState(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showEditJobModal, setShowEditJobModal] = useState(false);
  const [isUpdatingJob, setIsUpdatingJob] = useState(false);
  const [toolbarData, setToolbarData] = useState<{
    listedBy: string;
    onPullAll: () => void;
    onOrderAll: () => void;
    orderAllEligibleCount: number;
  } | null>(null);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  // Clear any stale sessionStorage from previous order/cancel so those jobs do not get stuck
  // (jobScroll / jobLastOrderedRow can point to wrong rows or prevent Shop from working)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k && (k.startsWith("jobScroll:") || k.startsWith("jobLastOrderedRow:"))) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => window.sessionStorage.removeItem(k));
  }, []);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const [dashboardSidebarCollapsed, setDashboardSidebarCollapsed] = useState(true);
  const [deliveryRecord, setDeliveryRecord] = useState<DeliveryRecord | null>(null);
  const [pulledSummary, setPulledSummary] = useState<{
    jobNumber: string;
    parts: Array<{ partId: string; partNumber: string; description: string | null; totalPulled: number }>;
  } | null>(null);
  const [isLoadingPulledSummary, setIsLoadingPulledSummary] = useState(false);
  const [addBackInventory, setAddBackInventory] = useState(true);
  const [itemsInPurchaseOrders, setItemsInPurchaseOrders] = useState<Set<string>>(
    new Set(),
  );
  const currentJobDisplayName =
    displayedLineItems[0]?.jobName ||
    currentJobName ||
    jobs.find((j) => j.jobNumber === selectedJobNumber)?.jobName ||
    "";

  // Load delivery when a job is selected (for Edit modal isServiceJob and header badge)
  useEffect(() => {
    if (!selectedJobNumber?.trim()) {
      setDeliveryRecord(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const deliveryQuery = new URLSearchParams({
          jobNumber: selectedJobNumber,
        });
        if (deliveryListContext && deliveryListContext.trim() !== "") {
          deliveryQuery.set("listNumber", deliveryListContext);
        }
        const res = await fetch(
          `/api/delivery/get?${deliveryQuery.toString()}`,
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled && data.delivery) setDeliveryRecord(data.delivery);
        else if (!cancelled) setDeliveryRecord(null);
      } catch {
        if (!cancelled) setDeliveryRecord(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedJobNumber, deliveryListContext]);

  // Load jobs list. Use `silent: true` after saves/mutations so we do not set
  // isLoadingJobs; that spinner replaces the whole main area and unmounts the
  // Overview scroll container (scroll jumps to top).
  const loadJobs = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    try {
      if (!silent) {
        setIsLoadingJobs(true);
      }
      setError(null);

      const response = await fetch("/api/jobs/list");
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to load jobs");
      }

      const data: JobListResponse = await response.json();
      setJobs(data.jobs);
    } catch (err) {
      console.error("Error loading jobs:", err);
      setError((err as Error).message);
    } finally {
      if (!silent) {
        setIsLoadingJobs(false);
      }
    }
  }, []);

  // Load line items for selected job
  const loadJobLineItems = useCallback(
    async (jobNumber: string) => {
      if (!permissionsLoading && !canViewJobs) {
        setJobAccessDenied(true);
        setLineItems([]);
        setCurrentJobName("");
        setJobMeta(null);
        setIsLoadingLineItems(false);
        return;
      }

      try {
        setIsLoadingLineItems(true);
        setError(null);
        setJobAccessDenied(false);

        const response = await fetch(
          `/api/jobs/get?jobNumber=${encodeURIComponent(
            jobNumber,
          )}&listNumber=${encodeURIComponent(listNumberContext)}`,
          {
            cache: "no-store",
            headers: { "Cache-Control": "no-cache" },
          },
        );
        if (!response.ok) {
          const errorData = await response.json();
          if (response.status === 403) {
            setJobAccessDenied(true);
            setLineItems([]);
            setCurrentJobName("");
            setJobMeta(null);
            return;
          }
          throw new Error(errorData.error || "Failed to load job details");
        }

        const data: JobDetailsResponse = await response.json();
        setLineItems(data.lineItems);
        setCurrentJobName(data.jobName || "");
        setJobMeta(data.jobMeta ?? null);
        setHasUnsavedChanges(false);
        setHasDeliveryUnsavedChanges(false);
      } catch (err) {
        console.error("Error loading job details:", err);
        setError((err as Error).message);
        setLineItems([]);
        setCurrentJobName("");
        setJobMeta(null);
      } finally {
        setIsLoadingLineItems(false);
      }
      },
      [canViewJobs, listNumberContext, permissionsLoading],
    );

  const refreshJobPreorderTotals = useCallback(async () => {
    if (!jobPreorderFeaturesEnabled) {
      setJobPreorderPoolAvailable(new Map());
      setJobPreorderOpenByPart(new Map());
      return;
    }
    const jn = selectedJobNumber?.trim();
    if (!jn) {
      setJobPreorderPoolAvailable(new Map());
      setJobPreorderOpenByPart(new Map());
      return;
    }
    try {
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(jn)}/job-preorders`,
      );
      if (!res.ok) return;
      const data = await res.json();
      const pool = data.poolAvailableByPart as Record<string, number> | undefined;
      const open = data.openByPart as Record<string, number> | undefined;
      setJobPreorderPoolAvailable(
        new Map(pool && typeof pool === "object" ? Object.entries(pool) : []),
      );
      setJobPreorderOpenByPart(
        new Map(open && typeof open === "object" ? Object.entries(open) : []),
      );
    } catch {
      /* non-blocking */
    }
  }, [selectedJobNumber]);

  useEffect(() => {
    void refreshJobPreorderTotals();
  }, [refreshJobPreorderTotals]);

  // Load jobs on mount
  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // Load job when jobNumber changes
  useEffect(() => {
    if (permissionsLoading) return;
    if (jobNumber) {
      setSelectedJobNumber(jobNumber);
      if (!canViewJobs) {
        setJobAccessDenied(true);
        setLineItems([]);
        setLineFilter("all");
        return;
      }
      loadJobLineItems(jobNumber);
      setLineFilter("all");
    }
  }, [canViewJobs, jobNumber, loadJobLineItems, permissionsLoading]);

  useEffect(() => {
    notesDeepLinkAppliedRef.current = false;
  }, [jobNumber]);

  const clearNoteDeepLink = useCallback(() => {
    notesDeepLinkAppliedRef.current = true;
    setOpenNoteId(null);
    if (typeof window !== "undefined" && jobNumber) {
      window.sessionStorage.removeItem(`tftp_openNoteId:${jobNumber}`);
    }
    const nextParams = new URLSearchParams(searchParams?.toString() ?? "");
    let changed = false;
    for (const key of ["tab", "openNoteId", "noteId"] as const) {
      if (nextParams.has(key)) {
        nextParams.delete(key);
        changed = true;
      }
    }
    if (!pathname) return;
    if (changed) {
      const qs = nextParams.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    }
  }, [jobNumber, pathname, router, searchParams]);

  const handleListChange = useCallback(
    (nextList: string) => {
      notesDeepLinkAppliedRef.current = true;
      setOpenNoteId(null);
      if (typeof window !== "undefined" && jobNumber) {
        window.sessionStorage.removeItem(`tftp_openNoteId:${jobNumber}`);
      }
      if (!pathname) return;
      setActiveTab("puller");
      router.replace(
        `${pathname}?list=${encodeURIComponent(nextList)}`,
      );
    },
    [jobNumber, pathname, router],
  );

  // Deep-link: when arriving from a notification email, open the Notes tab
  // and scroll to the exact note card (handled inside NotesTab).
  useEffect(() => {
    if (!jobNumber) return;
    if (!urlNoteId || urlNoteId.trim().length === 0) {
      // If auth redirected us, try to recover the noteId from sessionStorage.
      const key = `tftp_openNoteId:${jobNumber}`;
      if (typeof window === "undefined") return;
      const saved = window.sessionStorage.getItem(key);
      if (saved && saved.trim().length > 0) {
        setOpenNoteId(saved);
      }
      return;
    }

    // Save immediately so we keep it across any auth redirects.
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(`tftp_openNoteId:${jobNumber}`, urlNoteId);
    }
    setOpenNoteId(urlNoteId);
  }, [jobNumber, urlNoteId]);

  // Email deep-link: open Notes once (do not re-force when user switches tabs).
  useEffect(() => {
    if (isAuthLoading || !openNoteId || notesDeepLinkAppliedRef.current) return;
    notesDeepLinkAppliedRef.current = true;
    setActiveTab("notes");
  }, [isAuthLoading, openNoteId]);

  // URL ?tab= without openNoteId (e.g. shared links).
  useEffect(() => {
    if (isAuthLoading || openNoteId || !requestedTab) return;
    if (requestedTab === "preorder" && !jobPreorderFeaturesEnabled) return;
    setActiveTab((current) =>
      current !== requestedTab ? requestedTab : current,
    );
  }, [isAuthLoading, openNoteId, requestedTab]);

  useEffect(() => {
    if (!jobNumber || isLoadingLineItems || (listParam && listParam.trim())) {
      return;
    }
    const firstListNumber = lineItems[0]?.listNumber?.trim() || "1";
    if (!firstListNumber) return;

    if (!pathname) return;
    const nextParams = new URLSearchParams(searchParams?.toString() ?? "");
    nextParams.set("list", firstListNumber);
    router.replace(`${pathname}?${nextParams.toString()}`);
  }, [isLoadingLineItems, jobNumber, lineItems, listParam, pathname, router, searchParams]);

  // Reset "Only received" when switching away from Ordered filter
  useEffect(() => {
    if (lineFilter !== "ordered") {
      setShowOnlyReceived(false);
    }
  }, [lineFilter]);

  // Fetch items-in-purchase-orders when job or displayed items change
  useEffect(() => {
    if (!selectedJobNumber?.trim() || displayedLineItems.length === 0) {
      setItemsInPurchaseOrders(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/jobs/${encodeURIComponent(selectedJobNumber)}/items-in-purchase-orders`
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data.keys)) {
          setItemsInPurchaseOrders(new Set(data.keys));
        } else if (!cancelled) {
          setItemsInPurchaseOrders(new Set());
        }
      } catch {
        if (!cancelled) setItemsInPurchaseOrders(new Set());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedJobNumber, displayedLineItems]);

  // Check if user can access purchase order tab (ADMIN or PROJECT_MANAGER for this job)
  const canAccessPurchaseOrderTabForJob =
    canViewJobs && canUsePermission("job.purchase_order.view", false);
  const allowedTabs = useMemo<JobDetailTab[]>(() => {
    const tabs: JobDetailTab[] = [];
    if (canAccessPullerTab) tabs.push("puller");
    if (canAccessDeliveryTab) tabs.push("delivery");
    if (canAccessPreorderTab) tabs.push("preorder");
    if (canAccessStockBackTab) tabs.push("stock-back");
    if (canAccessPurchaseOrderTabForJob) tabs.push("purchase-order");
    if (canAccessAccessTab) tabs.push("access");
    if (canAccessNotesTab) tabs.push("notes");
    return tabs;
  }, [
    canAccessAccessTab,
    canAccessDeliveryTab,
    canAccessNotesTab,
    canAccessPreorderTab,
    canAccessPullerTab,
    canAccessPurchaseOrderTabForJob,
    canAccessStockBackTab,
  ]);
  const firstAllowedTab = allowedTabs[0] ?? null;
  const canAccessActiveTab = allowedTabs.includes(activeTab);
  const isJobAccessDenied =
    !isAuthLoading &&
    !permissionsLoading &&
    Boolean(selectedJobNumber) &&
    (jobAccessDenied || !canViewJobs || allowedTabs.length === 0);
  const hasAnyUnsavedChanges = hasUnsavedChanges || hasDeliveryUnsavedChanges;

  // Ensure user can only access tabs they have permission for
  useEffect(() => {
    if (isAuthLoading || permissionsLoading) return;
    if (canAccessActiveTab || !firstAllowedTab) return;
    setActiveTab(firstAllowedTab);
  }, [
    activeTab,
    canAccessActiveTab,
    firstAllowedTab,
    isAuthLoading,
    permissionsLoading,
  ]);

  const getOrCreateLiveSessionId = useCallback((): string => {
    if (liveSessionIdRef.current) {
      return liveSessionIdRef.current;
    }

    if (typeof window === "undefined") {
      liveSessionIdRef.current = `job-live-${Date.now()}`;
      return liveSessionIdRef.current;
    }

    const storageKey = "jobLiveSessionId";
    const existing = window.sessionStorage.getItem(storageKey);
    if (existing && existing.trim().length > 0) {
      liveSessionIdRef.current = existing;
      return existing;
    }

    const generated =
      typeof window.crypto?.randomUUID === "function"
        ? window.crypto.randomUUID()
        : `job-live-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    window.sessionStorage.setItem(storageKey, generated);
    liveSessionIdRef.current = generated;
    return generated;
  }, []);

  const leaveLiveViewingSession = useCallback(async () => {
    if (!selectedJobNumber) return;
    const sessionId = getOrCreateLiveSessionId();

    try {
      await fetch(`/api/jobs/${encodeURIComponent(selectedJobNumber)}/live-viewing`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          sessionId,
          listNumber: listNumberContext,
        }),
      });
    } catch {
      // Non-blocking on unload / navigation.
    }
  }, [getOrCreateLiveSessionId, listNumberContext, selectedJobNumber]);

  const sendLiveViewingHeartbeat = useCallback(async () => {
    if (!selectedJobNumber) {
      setLiveViewers([]);
      return;
    }

    const sessionId = getOrCreateLiveSessionId();

    try {
      const response = await fetch(
        `/api/jobs/${encodeURIComponent(selectedJobNumber)}/live-viewing`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            listNumber: listNumberContext,
            activeTab,
          }),
        },
      );

      if (!response.ok) {
        setLiveStatusError("Live viewing status is temporarily unavailable.");
        return;
      }

      const data = await response.json();
      setLiveViewers(Array.isArray(data?.viewers) ? data.viewers : []);
      setLiveStatusError(null);
    } catch {
      setLiveStatusError("Live viewing status is temporarily unavailable.");
    }
  }, [
    activeTab,
    getOrCreateLiveSessionId,
    listNumberContext,
    selectedJobNumber,
  ]);

  useEffect(() => {
    if (!selectedJobNumber) {
      setLiveViewers([]);
      return;
    }

    let intervalId: number | null = null;

    const beat = () => {
      if (document.hidden) return;
      void sendLiveViewingHeartbeat();
    };

    void sendLiveViewingHeartbeat();

    if (!document.hidden) {
      intervalId = window.setInterval(beat, LIVE_VIEW_POLL_INTERVAL_MS);
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (intervalId !== null) {
          clearInterval(intervalId);
          intervalId = null;
        }
        return;
      }

      void sendLiveViewingHeartbeat();
      if (intervalId === null) {
        intervalId = window.setInterval(beat, LIVE_VIEW_POLL_INTERVAL_MS);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [selectedJobNumber, sendLiveViewingHeartbeat]);

  useEffect(() => {
    if (!selectedJobNumber) return;

    const handlePageHide = () => {
      void leaveLiveViewingSession();
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      void leaveLiveViewingSession();
    };
  }, [leaveLiveViewingSession, selectedJobNumber]);

  const registerTabSaveHandler = useCallback(
    (handler: TabSaveHandler | null) => {
      setTabSaveHandler(() => handler);
    },
    [],
  );

  const hasGuardedUnsavedChanges =
    (activeTab === "puller" && hasUnsavedChanges) ||
    (activeTab === "delivery" && hasDeliveryUnsavedChanges);

  const unsavedContextLabel = activeTab === "delivery" ? "Delivery" : "Overview";

  const requestTabChange = useCallback(
    (nextTab: JobDetailTab) => {
      if (nextTab === activeTab) return;
      if (!allowedTabs.includes(nextTab)) return;
      if (nextTab !== "notes" && openNoteId) {
        clearNoteDeepLink();
      }
      void (async () => {
        if (
          activeTab === "delivery" &&
          hasDeliveryUnsavedChanges &&
          tabSaveHandler
        ) {
          setIsSavingBeforeLeave(true);
          try {
            const ok = await tabSaveHandler({ silent: true });
            if (ok) {
              setActiveTab(nextTab);
              return;
            }
          } finally {
            setIsSavingBeforeLeave(false);
          }
        }

        if (hasGuardedUnsavedChanges) {
          setPendingTabChange(nextTab);
          setPendingRouteChange(null);
          setPendingBrowserBack(false);
          setShowUnsavedOverviewModal(true);
          return;
        }
        setActiveTab(nextTab);
      })();
    },
    [
      activeTab,
      allowedTabs,
      clearNoteDeepLink,
      hasGuardedUnsavedChanges,
      hasDeliveryUnsavedChanges,
      openNoteId,
      tabSaveHandler,
    ],
  );

  const requestRouteChange = useCallback(
    async (path: string): Promise<boolean> => {
      if (!path || path === pathname) return true;

      if (
        activeTab === "delivery" &&
        hasDeliveryUnsavedChanges &&
        tabSaveHandler
      ) {
        setIsSavingBeforeLeave(true);
        try {
          const ok = await tabSaveHandler({ silent: true });
          if (ok) {
            return true;
          }
        } finally {
          setIsSavingBeforeLeave(false);
        }
      }

      if (hasGuardedUnsavedChanges) {
        setPendingTabChange(null);
        setPendingRouteChange(path);
        setPendingBrowserBack(false);
        setShowUnsavedOverviewModal(true);
        return false;
      }
      return true;
    },
    [
      activeTab,
      hasDeliveryUnsavedChanges,
      hasGuardedUnsavedChanges,
      pathname,
      tabSaveHandler,
    ],
  );

  const clearPendingNavigation = () => {
    setPendingTabChange(null);
    setPendingRouteChange(null);
    setPendingBrowserBack(false);
  };

  const clearPendingOverviewAction = () => {
    pendingOverviewActionRef.current = null;
    setPendingOverviewActionLabel(null);
  };

  const runPendingOverviewAction = () => {
    const action = pendingOverviewActionRef.current;
    clearPendingOverviewAction();
    action?.();
  };

  const requestOverviewAction = useCallback(
    (action: () => void, label: string) => {
      if (activeTab === "puller" && hasUnsavedChanges) {
        pendingOverviewActionRef.current = action;
        setPendingOverviewActionLabel(label);
        setPendingTabChange(null);
        setPendingRouteChange(null);
        setPendingBrowserBack(false);
        setShowUnsavedOverviewModal(true);
        return;
      }
      action();
    },
    [activeTab, hasUnsavedChanges],
  );

  const handleCancelUnsavedOverviewModal = () => {
    if (isSavingBeforeLeave) return;
    setShowUnsavedOverviewModal(false);
    clearPendingNavigation();
    clearPendingOverviewAction();
  };

  const handleDiscardOverviewChanges = () => {
    if (
      isSavingBeforeLeave ||
      (!pendingTabChange &&
        !pendingRouteChange &&
        !pendingBrowserBack &&
        pendingOverviewActionRef.current === null)
    ) {
      return;
    }

    const targetTab = pendingTabChange;
    const targetRoute = pendingRouteChange;
    const shouldGoBack = pendingBrowserBack;
    const shouldRunOverviewAction = pendingOverviewActionRef.current !== null;

    setHasUnsavedChanges(false);
    setHasDeliveryUnsavedChanges(false);
    setShowUnsavedOverviewModal(false);
    clearPendingNavigation();
    if (shouldRunOverviewAction) {
      setOverviewDiscardSignal((prev) => prev + 1);
    }

    if (targetTab) {
      clearPendingOverviewAction();
      setActiveTab(targetTab);
      return;
    }
    if (targetRoute) {
      clearPendingOverviewAction();
      router.push(targetRoute);
      return;
    }
    if (shouldGoBack) {
      clearPendingOverviewAction();
      allowNextPopRef.current = true;
      window.history.back();
      return;
    }
    if (shouldRunOverviewAction) {
      runPendingOverviewAction();
    } else {
      clearPendingOverviewAction();
    }
  };

  const handleSaveOverviewChanges = async () => {
    if (
      isSavingBeforeLeave ||
      (!pendingTabChange &&
        !pendingRouteChange &&
        !pendingBrowserBack &&
        pendingOverviewActionRef.current === null)
    ) {
      return;
    }

    const targetTab = pendingTabChange;
    const targetRoute = pendingRouteChange;
    const shouldGoBack = pendingBrowserBack;
    const shouldRunOverviewAction = pendingOverviewActionRef.current !== null;

    setShowUnsavedOverviewModal(false);
    clearPendingNavigation();

    if (!tabSaveHandler) {
      setError(
        `Please save your ${unsavedContextLabel} changes before leaving this screen.`,
      );
      setShowUnsavedOverviewModal(true);
      return;
    }

    try {
      setIsSavingBeforeLeave(true);
      const savedNow = await tabSaveHandler();
      if (savedNow) {
        if (targetTab) {
          clearPendingOverviewAction();
          setActiveTab(targetTab);
          return;
        }
        if (targetRoute) {
          clearPendingOverviewAction();
          router.push(targetRoute);
          return;
        }
        if (shouldGoBack) {
          clearPendingOverviewAction();
          allowNextPopRef.current = true;
          window.history.back();
          return;
        }
        if (shouldRunOverviewAction) {
          runPendingOverviewAction();
        } else {
          clearPendingOverviewAction();
        }
      }
    } finally {
      setIsSavingBeforeLeave(false);
    }
  };

  useEffect(() => {
    if (!hasGuardedUnsavedChanges || hasPushedGuardStateRef.current) return;
    window.history.pushState({ overviewUnsavedGuard: true }, "", window.location.href);
    hasPushedGuardStateRef.current = true;
  }, [hasGuardedUnsavedChanges]);

  useEffect(() => {
    if (hasGuardedUnsavedChanges) return;
    hasPushedGuardStateRef.current = false;
  }, [hasGuardedUnsavedChanges]);

  useEffect(() => {
    const handlePopState = () => {
      if (allowNextPopRef.current) {
        allowNextPopRef.current = false;
        return;
      }
      if (!hasGuardedUnsavedChanges) return;

      window.history.pushState({ overviewUnsavedGuard: true }, "", window.location.href);
      setPendingTabChange(null);
      setPendingRouteChange(null);
      setPendingBrowserBack(true);
      setShowUnsavedOverviewModal(true);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [hasGuardedUnsavedChanges]);

  useEffect(() => {
    const handleDocumentNavigation = (event: MouseEvent) => {
      if (!hasGuardedUnsavedChanges) return;
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;

      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;

      const rawHref = anchor.getAttribute("href");
      if (!rawHref) return;
      if (
        rawHref.startsWith("#") ||
        rawHref.startsWith("mailto:") ||
        rawHref.startsWith("tel:")
      ) {
        return;
      }

      const nextUrl = new URL(anchor.href, window.location.href);
      const currentUrl = new URL(window.location.href);
      if (nextUrl.origin !== currentUrl.origin) return;

      const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
      const currentPath = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
      if (nextPath === currentPath) return;

      event.preventDefault();
      void (async () => {
        if (
          activeTab === "delivery" &&
          hasDeliveryUnsavedChanges &&
          tabSaveHandler
        ) {
          setIsSavingBeforeLeave(true);
          try {
            const ok = await tabSaveHandler({ silent: true });
            if (ok) {
              router.push(nextPath);
              return;
            }
          } finally {
            setIsSavingBeforeLeave(false);
          }
        }
        setPendingTabChange(null);
        setPendingRouteChange(nextPath);
        setPendingBrowserBack(false);
        setShowUnsavedOverviewModal(true);
      })();
    };

    document.addEventListener("click", handleDocumentNavigation, true);
    return () =>
      document.removeEventListener("click", handleDocumentNavigation, true);
  }, [
    activeTab,
    hasDeliveryUnsavedChanges,
    hasGuardedUnsavedChanges,
    router,
    tabSaveHandler,
  ]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasGuardedUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasGuardedUnsavedChanges]);

  // Handle save
  const handleSave = async (
    updates: Map<
      number,
      {
        quantityPulled?: number;
        quantityPulledFromPreorder?: number;
        quantityFab?: number;
        pulledBy?: string;
        pulledDate?: string;
        ordered?: string;
        receivedFromOrder?: string;
        type?: string;
        partNumber?: string;
        description?: string;
        uom?: string;
        quantityNeeded?: number;
        quantityOrdered?: number;
        manualCost?: number | null;
        supplier?: string;
        lineOrder?: number | null;
      }
    >,
  ) => {
    if (updates.size === 0 || !selectedJobNumber) return;

    const sameNumber = (
      next: number | null | undefined,
      current: number | null | undefined,
    ) => {
      const nextValue = next == null ? null : Number(next);
      const currentValue = current == null ? null : Number(current);
      return nextValue === currentValue;
    };
    const sameString = (
      next: string | null | undefined,
      current: string | null | undefined,
    ) => (next ?? "") === (current ?? "");
    const sameNullableNumber = (
      next: number | null | undefined,
      current: number | null | undefined,
    ) => {
      if (next == null && current == null) return true;
      return sameNumber(next, current);
    };

    const sanitizedUpdates = new Map<number, LineItemUpdate>();
    updates.forEach((data, rowIndex) => {
      const item = lineItems.find((line) => line.rowIndex === rowIndex);
      if (!item) return;

      const patch: LineItemUpdate = { rowIndex };
      if (
        data.quantityPulled !== undefined &&
        !sameNumber(data.quantityPulled, item.quantityPulled)
      ) {
        patch.quantityPulled = data.quantityPulled;
      }
      if (
        data.quantityPulledFromPreorder !== undefined &&
        !sameNumber(
          data.quantityPulledFromPreorder,
          item.quantityPulledFromPreorder ?? item.quantityPreordered,
        )
      ) {
        patch.quantityPulledFromPreorder = data.quantityPulledFromPreorder;
      }
      if (
        data.quantityFab !== undefined &&
        !sameNumber(data.quantityFab, item.quantityFab)
      ) {
        patch.quantityFab = data.quantityFab;
      }
      if (
        data.pulledBy !== undefined &&
        !sameString(data.pulledBy, item.pulledBy)
      ) {
        patch.pulledBy = data.pulledBy;
      }
      if (
        data.pulledDate !== undefined &&
        !sameString(data.pulledDate, item.pulledDate)
      ) {
        patch.pulledDate = data.pulledDate;
      }
      if (
        data.ordered !== undefined &&
        !sameString(data.ordered, item.ordered)
      ) {
        patch.ordered = data.ordered;
      }
      if (
        data.receivedFromOrder !== undefined &&
        !sameString(data.receivedFromOrder, item.receivedFromOrder)
      ) {
        patch.receivedFromOrder = data.receivedFromOrder;
      }
      if (data.type !== undefined && !sameString(data.type, item.type)) {
        patch.type = data.type;
      }
      if (
        data.partNumber !== undefined &&
        !sameString(data.partNumber, item.partNumber)
      ) {
        patch.partNumber = data.partNumber;
      }
      if (
        data.description !== undefined &&
        !sameString(data.description, item.description)
      ) {
        patch.description = data.description;
      }
      if (data.uom !== undefined && !sameString(data.uom, item.uom)) {
        patch.uom = data.uom;
      }
      if (
        data.quantityNeeded !== undefined &&
        !sameNumber(data.quantityNeeded, item.quantityNeeded)
      ) {
        patch.quantityNeeded = data.quantityNeeded;
      }
      if (
        data.quantityOrdered !== undefined &&
        !sameNullableNumber(data.quantityOrdered, item.quantityOrdered)
      ) {
        patch.quantityOrdered = data.quantityOrdered;
      }
      if (
        data.manualCost !== undefined &&
        !sameNullableNumber(data.manualCost, item.manualCost)
      ) {
        patch.manualCost = data.manualCost;
      }
      if (data.supplier !== undefined && !sameString(data.supplier, item.type)) {
        patch.supplier = data.supplier;
      }
      if (
        data.lineOrder !== undefined &&
        !sameNullableNumber(data.lineOrder, item.lineOrder ?? null)
      ) {
        patch.lineOrder = data.lineOrder;
      }

      if (Object.keys(patch).length > 1) {
        sanitizedUpdates.set(rowIndex, patch);
      }
    });

    if (sanitizedUpdates.size === 0) {
      setHasUnsavedChanges(false);
      return;
    }

    const updateList = Array.from(sanitizedUpdates.values());
    const hasPullUpdates = updateList.some(
      (data) =>
        data.quantityPulled !== undefined ||
        data.pulledBy !== undefined ||
        data.pulledDate !== undefined,
    );
    const hasOrderUpdates = updateList.some(
      (data) => data.ordered !== undefined || data.quantityOrdered !== undefined,
    );
    const hasLineItemUpdates = updateList.some(
      (data) =>
        data.quantityPulledFromPreorder !== undefined ||
        data.quantityFab !== undefined ||
        data.type !== undefined ||
        data.partNumber !== undefined ||
        data.description !== undefined ||
        data.uom !== undefined ||
        data.quantityNeeded !== undefined ||
        data.supplier !== undefined ||
        data.lineOrder !== undefined,
    );
    const hasUnitCostUpdates = updateList.some(
      (data) => data.manualCost !== undefined,
    );

    let allowedToSave =
      (!hasPullUpdates || canPullFromShop) &&
      (!hasOrderUpdates || canOrderLineItems) &&
      (!hasLineItemUpdates || canEditLineItems) &&
      (!hasUnitCostUpdates || canEditPurchaseOrderUnitCost);

    if (!allowedToSave) {
      const fresh = await refreshPermissions();
      const freshHas = (key: PermissionKey) => fresh.permissions[key] === true;
      allowedToSave =
        (!hasPullUpdates || freshHas("job.puller.pull_from_shop")) &&
        (!hasOrderUpdates || freshHas("job.puller.order")) &&
        (!hasLineItemUpdates || freshHas("job.puller.edit_line")) &&
        (!hasUnitCostUpdates || freshHas("job.purchase_order.edit_unit_cost"));
    }

    if (!allowedToSave) {
      setError(
        "You do not have permission to make one or more of these changes. Contact your administrator for access.",
      );
      return;
    }

    try {
      setIsSaving(true);
      setError(null);

      const requestBody: BatchUpdateRequest & {
        listNumberContext?: string;
      } = {
        jobNumber: selectedJobNumber,
        updates: Array.from(sanitizedUpdates.entries()).map(([rowIndex, data]) => ({
          rowIndex,
          quantityPulled: data.quantityPulled,
          quantityPulledFromPreorder: data.quantityPulledFromPreorder,
          quantityFab: data.quantityFab,
          pulledBy: data.pulledBy,
          pulledDate: data.pulledDate,
          ordered: data.ordered,
          receivedFromOrder: data.receivedFromOrder,
          type: data.type,
          partNumber: data.partNumber,
          description: data.description,
          uom: data.uom,
          quantityNeeded: data.quantityNeeded,
          quantityOrdered: data.quantityOrdered,
          manualCost: data.manualCost,
          supplier: data.supplier,
          lineOrder: data.lineOrder,
        })),
        listNumberContext,
      };

      // Debug: log the request body to see if supplier is included
      console.log(
        "[page.tsx] Sending update request:",
        JSON.stringify(requestBody, null, 2),
      );

      const response = await fetch("/api/jobs/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json();

        // Check if it's an insufficient stock error
        if (
          response.status === 409 &&
          errorData.error === "INSUFFICIENT_STOCK"
        ) {
          const insufficientItems = errorData.insufficientStockItems || [];
          let errorMessage =
            "Insufficient inventory for the following part(s):\n";

          insufficientItems.forEach(
            (item: { partNumber: string; requested: number }) => {
              errorMessage += `\n- ${item.partNumber}: Requested ${item.requested}, but insufficient stock available`;
            },
          );

          errorMessage += "\n\nPlease reduce quantities and try again.";
          setError(errorMessage);
          throw new Error(errorMessage);
        }

        if (
          response.status === 409 &&
          errorData.error === "FULFILLMENT_PATH_BLOCKED"
        ) {
          const errorMessage =
            typeof errorData.message === "string" && errorData.message.trim()
              ? errorData.message
              : "Could not save: FAB and Shop totals would exceed Needed.";
          setError(errorMessage);
          throw new Error(errorMessage);
        }

        if (response.status === 403 && errorData.error === "JOB_ACCESS_REQUIRED") {
          const errorMessage =
            "You have edit permissions, but you are not on the Job Access list for this job/list. Ask an admin to add you in the Access tab.";
          setError(errorMessage);
          throw new Error(errorMessage);
        }

        if (
          response.status === 403 &&
          errorData.error === "JOB_TYPE_VISIBILITY_REQUIRED"
        ) {
          const errorMessage =
            "You do not have visibility for this job type. Ask an admin to enable the matching contract/service job visibility.";
          setError(errorMessage);
          throw new Error(errorMessage);
        }

        throw new Error(
          typeof errorData.message === "string" && errorData.message.trim()
            ? errorData.message
            : errorData.error || "Failed to save changes",
        );
      }

      const data: UpdateJobResponse = await response.json();

      // Update local state with fresh data
      setLineItems(data.lineItems);
      setHasUnsavedChanges(false);

      // Refresh jobs list to update summary counts (no full-area loading spinner)
      await loadJobs({ silent: true });

      // Show success message (optional)
      console.log(`Successfully updated ${data.updatedCount} line items`);
    } catch (err) {
      console.error("Error saving changes:", err);
      const errorMessage = (err as Error).message;
      setError(errorMessage);
      throw err; // Re-throw so the table component knows the save failed
    } finally {
      setIsSaving(false);
    }
  };

  // Handle add line item
  const handleAddLineItem = async (newItem: {
    partNumber: string;
    description: string;
    uom: string;
    quantityNeeded: number;
    type: string;
  }): Promise<void> => {
    if (!selectedJobNumber) {
      throw new Error("No job selected");
    }

    if (!canAddLineItems) {
      throw new Error(
        "You do not have permission to add line items. Contact your administrator for access.",
      );
    }

    setIsAddingLine(true);

    try {
      // Job name: use current line items first (we're on this job's page), then jobs list.
      // The jobs list is limited to 100 entries, so the current job may not be in it.
      const jobName =
        displayedLineItems[0]?.jobName ??
        jobs.find((j) => j.jobNumber === selectedJobNumber)?.jobName ??
        "Job";

      const listForNewLine = listParam ?? displayedLineItems[0]?.listNumber ?? "1";
      const response = await fetch("/api/jobs/add-line", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jobNumber: selectedJobNumber,
          jobName,
          listNumber: listForNewLine,
          listNumberContext,
          ...newItem,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to add line item");
      }

      const data = await response.json();
      setLineItems(data.lineItems);
      setShowAddLineModal(false);

      // Refresh jobs list to update summary counts (no full-area loading spinner)
      await loadJobs({ silent: true });

      console.log("Successfully added line item");
    } catch (err) {
      console.error("Error adding line item:", err);
      // Re-throw the error so the modal can catch and display it
      throw err;
    } finally {
      setIsAddingLine(false);
    }
  };

  // Handle update job information
  const handleUpdateJobInfo = async (jobInfo: {
    jobNumber?: string;
    jobName: string;
    listNumber?: string | null;
    area?: string | null;
    locationShipTo?: string | null;
    stocklistDeliveryShipDate?: string | null;
    listedBy?: string | null;
    deliveryDate?: string;
    deliveryDateChangeNote?: string | null;
    isServiceJob?: boolean;
    accessTypeChangeConfirmed?: boolean;
  }) => {
    if (!selectedJobNumber) return;
    if (!canEditJobInfo) {
      setError(
        "You do not have permission to edit job information. Contact your administrator for access.",
      );
      return;
    }

    try {
      setIsUpdatingJob(true);
      setError(null);

      const currentListNumber =
        listParam ?? displayedLineItems[0]?.listNumber ?? null;
      const response = await fetch(
        `/api/jobs/${selectedJobNumber}/update-info`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...jobInfo,
            listNumber: jobInfo.listNumber?.trim() || null,
            currentListNumber,
            listNumberContext,
            notificationSource: JOB_UPDATED_NOTIFICATION_SOURCE_OVERVIEW_EDIT,
          }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        const err = new Error(errorData.error || "Failed to update job information") as JobTypeAccessReviewError;
        if (errorData?.accessReview) {
          err.accessReview = errorData.accessReview;
          err.canConfirm = errorData.canConfirm === true;
          err.code = typeof errorData.code === "string" ? errorData.code : undefined;
          setError(null);
        }
        throw err;
      }

      const data = await response.json();
      setLineItems(data.lineItems);
      setJobMeta(data.jobMeta ?? null);
      setShowEditJobModal(false);

      if (data.editorLostAccessAfterSave === true) {
        await loadJobs({ silent: true });
        router.replace("/jobs");
        return;
      }

      const finalJobNumber = data.jobNumber ?? selectedJobNumber;
      const finalJobName =
        typeof data.jobName === "string" && data.jobName.trim().length > 0
          ? data.jobName.trim()
          : jobInfo.jobName.trim();
      setCurrentJobName(finalJobName);
      const finalListNumber =
        data.listNumber ?? listParam ?? displayedLineItems[0]?.listNumber ?? "1";

      // If job number changed, update the selected job number
      if (data.jobNumber && data.jobNumber !== selectedJobNumber) {
        setSelectedJobNumber(data.jobNumber);
      }
      // Update URL when job number or list number changed so the user sees the correct list
      if (data.jobNumber || data.listNumber) {
        router.replace(
          `/job/${finalJobNumber}?list=${encodeURIComponent(finalListNumber)}`
        );
      }

      // Refetch delivery for the final job+list so header and Delivery tab show correct data
      if (finalJobNumber) {
        try {
          const deliveryQuery = new URLSearchParams({
            jobNumber: finalJobNumber,
          });
          deliveryQuery.set("listNumber", finalListNumber);
          const deliveryRes = await fetch(
            `/api/delivery/get?${deliveryQuery.toString()}`
          );
          if (deliveryRes.ok) {
            const deliveryData = await deliveryRes.json();
            setDeliveryRecord(deliveryData.delivery ?? null);
          }
        } catch {
          // ignore
        }
      }

      // Refresh jobs list to update summary (no full-area loading spinner)
      await loadJobs({ silent: true });
      // Optimistically reflect updated name in local jobs state immediately
      setJobs((prev) =>
        prev.map((j) =>
          j.jobNumber === finalJobNumber ? { ...j, jobName: finalJobName } : j,
        ),
      );
    } catch (err) {
      console.error("Error updating job info:", err);
      setError((err as Error).message);
      throw err; // Re-throw so modal can display error
    } finally {
      setIsUpdatingJob(false);
    }
  };

  // Handle delete line item
  const handleDeleteLineItem = async (partNumber: string, listNumber: string) => {
    if (!selectedJobNumber) return;
    if (!canDeleteLineItems) {
      setError(
        "You do not have permission to delete line items. Contact your administrator for access.",
      );
      return;
    }

    try {
      setError(null);

      const response = await fetch("/api/jobs/delete-line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobNumber: selectedJobNumber,
          listNumber: listNumber || "1",
          partNumber: partNumber,
          listNumberContext,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to delete part");
      }

      const data = await response.json();
      setLineItems(data.lineItems);

      // Refresh jobs list to update summary (no full-area loading spinner)
      await loadJobs({ silent: true });
    } catch (err) {
      console.error("Error deleting part:", err);
      setError((err as Error).message);
      throw err; // Re-throw so modal can display error
    }
  };

  const handleOverviewFilterChange = useCallback(
    (nextFilter: LineFilter) => {
      requestOverviewAction(() => {
        setLineFilter(nextFilter);
      }, "change the Overview filter");
    },
    [requestOverviewAction],
  );

  const handleShowOnlyReceivedToggle = useCallback(() => {
    requestOverviewAction(() => {
      setShowOnlyReceived((prev) => !prev);
    }, "change the Overview filter");
  }, [requestOverviewAction]);

  const handleShowUnpulledOnlyToggle = useCallback(() => {
    requestOverviewAction(() => {
      setShowUnpulledOnly((prev) => !prev);
    }, "change the Overview filter");
  }, [requestOverviewAction]);

  // Handle delete job (or delete only current list when listParam is set)
  const handleDeleteJob = async () => {
    if (!selectedJobNumber) return;
    if (!canDeleteJobs) {
      setError(
        "You do not have permission to delete jobs. Contact your administrator for access.",
      );
      return;
    }

    try {
      setIsDeleting(true);
      setError(null);

      const body: {
        jobNumber: string;
        listNumber?: string;
        addBackInventory?: boolean;
      } = {
        jobNumber: selectedJobNumber,
      };
      // When viewing a specific list, delete only that list's line items
      if (listParam && listParam.trim()) {
        body.listNumber = listParam.trim();
      } else {
        body.addBackInventory = addBackInventory;
      }

      const response = await fetch("/api/jobs/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to delete job");
      }

      setShowDeleteConfirmModal(false);

      await response.json();

      // After any delete (full job or single list), reset local state and
      // return to the jobs management page instead of redirecting to another list.
      setSelectedJobNumber(null);
      setLineItems([]);
      setActiveTab("puller");
      await loadJobs({ silent: true });
      router.push("/jobs");
    } catch (err) {
      console.error("Error deleting job:", err);
      setError((err as Error).message);
    } finally {
      setIsDeleting(false);
    }
  };

  // Handle ESC key to close modals
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showDeleteConfirmModal && !isDeleting) {
          setShowDeleteConfirmModal(false);
          setError(null);
        } else if (showEditJobModal && !isUpdatingJob) {
          setShowEditJobModal(false);
          setError(null);
        }
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [showDeleteConfirmModal, isDeleting, showEditJobModal, isUpdatingJob]);

  // Load pulled parts summary when delete modal opens for full job delete
  useEffect(() => {
    const loadPulledSummary = async () => {
      if (!showDeleteConfirmModal || !selectedJobNumber) {
        setPulledSummary(null);
        setIsLoadingPulledSummary(false);
        setAddBackInventory(true);
        return;
      }

      try {
        setIsLoadingPulledSummary(true);
        const res = await fetch(
          `/api/jobs/${encodeURIComponent(selectedJobNumber)}/pulled-summary`
        );
        if (!res.ok) {
          // If summary fails, just skip showing extra info; deletion will still work
          console.error("Failed to load pulled summary for job", selectedJobNumber);
          setPulledSummary(null);
          return;
        }
        const data = await res.json();
        setPulledSummary(data);
        setAddBackInventory(true);
      } catch (err) {
        console.error("Error loading pulled summary:", err);
        setPulledSummary(null);
      } finally {
        setIsLoadingPulledSummary(false);
      }
    };

    loadPulledSummary();
  }, [showDeleteConfirmModal, selectedJobNumber, listParam]);

  // Close Actions dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(event.target as Node)) {
        setShowActionsMenu(false);
      }
    };
    if (showActionsMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showActionsMenu]);

  const formatLiveViewerName = (viewer: LiveViewer) => {
    if (viewer.isCurrentUser) return "You";
    if (viewer.userName && viewer.userName.trim().length > 0) {
      return viewer.userName;
    }
    return viewer.userEmail;
  };

  const isAwaitingListRedirect =
    Boolean(jobNumber) &&
    !(listParam && listParam.trim()) &&
    lineItems.length > 0 &&
    !isLoadingLineItems &&
    !jobAccessDenied;

  const showJobBootLoader =
    permissionsLoading ||
    isLoadingJobs ||
    isAwaitingListRedirect ||
    (Boolean(selectedJobNumber) && isLoadingLineItems && !jobAccessDenied);

  const jobBootLoaderMessage =
    isLoadingJobs || permissionsLoading ? "Loading jobs..." : "Loading line items...";

  return (
    <>
    <div className="h-dvh bg-gray-50 dark:bg-slate-900 flex overflow-hidden">
      {/* Left Dashboard Sidebar */}
      <DashboardSidebar
        onCollapsedChange={setDashboardSidebarCollapsed}
        onBeforeNavigate={requestRouteChange}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {/* Header */}
        <header className="relative z-20 flex-shrink-0 bg-white dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700/50 shadow-xl backdrop-blur-sm">
          <div className="px-6 py-4">
            <div className="flex items-start justify-between gap-4">
              {/* Left: Job title and meta */}
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white">
                  {selectedJobNumber
                    ? displayedLineItems[0]?.jobName ||
                      currentJobName ||
                      jobs.find((j) => j.jobNumber === selectedJobNumber)?.jobName ||
                      "Job"
                    : "Job Pulling Dashboard"}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-medium">
                  {selectedJobNumber ? (
                    <>
                      Job Number: {selectedJobNumber}
                      <JobListSwitcher
                        jobNumber={selectedJobNumber}
                        currentListNumber={currentListNumber}
                        onListChange={handleListChange}
                        onInaccessibleCurrentList={handleListChange}
                      />
                      {(displayedLineItems[0]?.area ?? jobMeta?.area) &&
                        (displayedLineItems[0]?.area ?? jobMeta?.area)?.trim() !== "" && (
                        <span className="ml-3">Area: {displayedLineItems[0]?.area ?? jobMeta?.area}</span>
                      )}
                      {deliveryRecord?.isServiceJob === true && (
                        <span className="ml-3 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 dark:bg-purple-500/20 text-purple-800 dark:text-purple-200">
                          Service job
                        </span>
                      )}
                    </>
                  ) : (
                    "Fire-Protection Materials Shop Operations"
                  )}
                </p>
              </div>

              {/* Right: Live viewing status */}
              {selectedJobNumber && (
                <div className="ml-2 flex flex-col items-end gap-1">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap">
                    Live viewing
                  </span>
                  <div className="flex flex-wrap justify-end gap-1 max-w-xs">
                    {liveViewers.length === 0 ? (
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        No active viewers
                      </span>
                    ) : (
                      liveViewers.map((viewer) => (
                        <span
                          key={viewer.userId}
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium border ${
                            viewer.isCurrentUser
                              ? "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-500/20 dark:text-blue-200 dark:border-blue-500/40"
                              : "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-200 dark:border-emerald-500/40"
                          }`}
                        >
                          {formatLiveViewerName(viewer)}
                        </span>
                      ))
                    )}
                  </div>
                  {liveStatusError && (
                    <span className="text-xs text-amber-700 dark:text-amber-300 text-right max-w-xs">
                      {liveStatusError}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Tabs */}
            {selectedJobNumber && !showJobBootLoader && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <nav className="flex flex-wrap gap-2" aria-label="Tabs">
                  {canAccessPullerTab && (
                    <button
                      onClick={() => requestTabChange("puller")}
                      className={`px-5 py-2.5 rounded-xl font-semibold text-sm transition-all whitespace-nowrap ${
                        activeTab === "puller"
                          ? "bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/30 transform scale-105"
                          : "bg-slate-200 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white hover:shadow-md"
                      }`}
                    >
                      Overview
                    </button>
                  )}
                  {canAccessDeliveryTab && (
                    <button
                      onClick={() => requestTabChange("delivery")}
                      className={`px-5 py-2.5 rounded-xl font-semibold text-sm transition-all whitespace-nowrap ${
                        activeTab === "delivery"
                          ? "bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/30 transform scale-105"
                          : "bg-slate-200 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white hover:shadow-md"
                      }`}
                    >
                      Delivery
                    </button>
                  )}
                  {canAccessPreorderTab && (
                    <button
                      onClick={() => requestTabChange("preorder")}
                      className={`px-5 py-2.5 rounded-xl font-semibold text-sm transition-all whitespace-nowrap ${
                        activeTab === "preorder"
                          ? "bg-gradient-to-r from-fuchsia-500 to-violet-600 text-white shadow-lg shadow-fuchsia-500/30 transform scale-105"
                          : "bg-slate-200 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white hover:shadow-md"
                      }`}
                    >
                      Pre-order
                    </button>
                  )}
                  {canAccessStockBackTab && (
                    <button
                      onClick={() => requestTabChange("stock-back")}
                      className={`px-5 py-2.5 rounded-xl font-semibold text-sm transition-all whitespace-nowrap ${
                        activeTab === "stock-back"
                          ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/30 transform scale-105"
                          : "bg-slate-200 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white hover:shadow-md"
                      }`}
                    >
                      Stock In
                    </button>
                  )}
                  {canAccessPurchaseOrderTabForJob && (
                    <button
                      onClick={() => requestTabChange("purchase-order")}
                      className={`px-5 py-2.5 rounded-xl font-semibold text-sm transition-all whitespace-nowrap ${
                        activeTab === "purchase-order"
                          ? "bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow-lg shadow-purple-500/30 transform scale-105"
                          : "bg-slate-200 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white hover:shadow-md"
                      }`}
                    >
                      Purchase Order
                    </button>
                  )}
                  {canAccessAccessTab && (
                    <button
                      onClick={() => requestTabChange("access")}
                      className={`px-5 py-2.5 rounded-xl font-semibold text-sm transition-all whitespace-nowrap ${
                        activeTab === "access"
                          ? "bg-gradient-to-r from-teal-500 to-cyan-600 text-white shadow-lg shadow-teal-500/30 transform scale-105"
                          : "bg-slate-200 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white hover:shadow-md"
                      }`}
                    >
                      Access
                    </button>
                  )}
                  {canAccessNotesTab && (
                    <button
                      onClick={() => requestTabChange("notes")}
                      className={`px-5 py-2.5 rounded-xl font-semibold text-sm transition-all whitespace-nowrap ${
                        activeTab === "notes"
                          ? "bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/30 transform scale-105"
                          : "bg-slate-200 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white hover:shadow-md"
                      }`}
                    >
                      Notes
                    </button>
                  )}
                </nav>
                {activeTab === "puller" && (
                  <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap justify-end ml-auto">
                    <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded-lg text-sm font-medium shadow-sm whitespace-nowrap flex-shrink-0">
                      <span className="text-sm text-slate-700 dark:text-slate-300 font-bold">
                        Listed By:
                      </span>
                      <span className="text-sm">
                        {toolbarData?.listedBy ||
                          jobMeta?.listedByName ||
                          jobMeta?.listedBy ||
                          "Not set"}
                      </span>
                    </div>
                    {/* Inline action buttons - visible above breakpoint; 1260px when sidebar closed, 1450px when sidebar open */}
                    {canUseOverviewActions && (
                      <div className={`hidden items-center gap-2 flex-shrink-0 ${dashboardSidebarCollapsed ? "toolbar:flex" : "min-[1451px]:flex"}`}>
                        {toolbarData && displayedLineItems.length > 0 && (
                          <>
                            <button
                              onClick={toolbarData.onPullAll}
                              disabled={isSaving || !canPullFromShop}
                              title={!canPullFromShop ? "Pull from shop permission required" : undefined}
                              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg shadow-md hover:shadow-lg transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                            >
                              Pull All
                            </button>
                            <button
                              onClick={toolbarData.onOrderAll}
                              disabled={
                                isSaving ||
                                !canOrderLineItems ||
                                toolbarData.orderAllEligibleCount === 0
                              }
                              title={
                                !canOrderLineItems
                                  ? "Order line items permission required"
                                  : toolbarData.orderAllEligibleCount === 0
                                  ? "No remaining parts to order"
                                  : undefined
                              }
                              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-md hover:shadow-lg transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                            >
                              Order All
                            </button>
                          </>
                        )}
                        {canAddLineItems && (
                          <button
                            onClick={() => setShowAddLineModal(true)}
                            disabled={isSaving}
                            className="px-4 py-2 bg-gradient-to-r from-purple-500 to-purple-600 text-white font-semibold rounded-lg shadow-md hover:shadow-lg transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                          >
                            + Add Part
                          </button>
                        )}
                        {canEditJobInfo && (
                          <button
                            onClick={() => setShowEditJobModal(true)}
                            disabled={isSaving}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-md hover:shadow-lg transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    )}
                    {canDeleteJobs && (
                      <button
                        onClick={() => setShowDeleteConfirmModal(true)}
                        disabled={isSaving}
                        className={`hidden px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg shadow-md hover:shadow-lg transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap flex-shrink-0 ${dashboardSidebarCollapsed ? "toolbar:inline-flex" : "min-[1451px]:inline-flex"}`}
                      >
                        Delete
                      </button>
                    )}
                    {/* Actions dropdown - visible below breakpoint; 1260px when sidebar closed, 1450px when sidebar open */}
                    {canUseOverviewActions && (
                    <div className={`relative flex-shrink-0 ${dashboardSidebarCollapsed ? "toolbar:hidden" : "min-[1451px]:hidden"}`} ref={actionsMenuRef}>
                      <button
                        type="button"
                        onClick={() => setShowActionsMenu((prev) => !prev)}
                        disabled={isSaving}
                        className="flex items-center gap-2 px-4 py-2.5 bg-slate-200 dark:bg-slate-600 hover:bg-slate-300 dark:hover:bg-slate-500 text-slate-900 dark:text-white font-semibold rounded-lg shadow-sm transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap min-h-[44px]"
                        aria-expanded={showActionsMenu}
                        aria-haspopup="true"
                      >
                        Actions
                        <svg className={`w-4 h-4 transition-transform ${showActionsMenu ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {showActionsMenu && (
                        <div className="absolute right-0 top-full mt-1 py-1 w-48 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-xl shadow-xl z-[100] flex flex-col">
                          {canUseOverviewActions && (
                            <>
                              {toolbarData && displayedLineItems.length > 0 && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      toolbarData.onPullAll();
                                      setShowActionsMenu(false);
                                    }}
                                    disabled={isSaving || !canPullFromShop}
                                    title={!canPullFromShop ? "Pull from shop permission required" : undefined}
                                    className="w-full text-left px-4 py-3 text-sm font-semibold text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                  >
                                    Pull All
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      toolbarData.onOrderAll();
                                      setShowActionsMenu(false);
                                    }}
                                    disabled={
                                      isSaving ||
                                      !canOrderLineItems ||
                                      toolbarData.orderAllEligibleCount === 0
                                    }
                                    title={
                                      !canOrderLineItems
                                        ? "Order line items permission required"
                                        : toolbarData.orderAllEligibleCount === 0
                                          ? "No remaining parts to order"
                                          : undefined
                                    }
                                    className="w-full text-left px-4 py-3 text-sm font-semibold text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                  >
                                    Order All
                                  </button>
                                </>
                              )}
                              {canAddLineItems && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowAddLineModal(true);
                                    setShowActionsMenu(false);
                                  }}
                                  disabled={isSaving}
                                  className="w-full text-left px-4 py-3 text-sm font-semibold text-purple-700 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                >
                                  + Add Part
                                </button>
                              )}
                              {canEditJobInfo && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowEditJobModal(true);
                                    setShowActionsMenu(false);
                                  }}
                                  disabled={isSaving}
                                  className="w-full text-left px-4 py-3 text-sm font-semibold text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                >
                                  Edit
                                </button>
                              )}
                            </>
                          )}
                          {canDeleteJobs && (
                            <button
                              type="button"
                              onClick={() => {
                                setShowDeleteConfirmModal(true);
                                setShowActionsMenu(false);
                              }}
                              disabled={isSaving}
                              className="w-full text-left px-4 py-3 text-sm font-semibold text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                              Delete
                            </button>
                    )}
                        </div>
                )}
                    </div>
                    )}
                  </div>
                )}
                {activeTab !== "puller" && (
                  <div
                    id="tab-actions-portal"
                    className="flex items-center gap-3 ml-auto"
                  ></div>
                )}
              </div>
            )}
          </div>
        </header>

        {/* Error Banner */}
        {error && !isJobAccessDenied && (
          <div className="px-6 pt-4">
            <div className="bg-red-500 border border-red-600 rounded-xl p-4 flex items-start space-x-3 shadow-lg shadow-red-500/20 backdrop-blur-sm text-white">
              <svg
                className="w-6 h-6 flex-shrink-0 animate-pulse"
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
                <h3 className="text-sm font-bold">Error</h3>
                <p className="text-sm text-white/90 mt-1">{error}</p>
              </div>
              <button
                onClick={() => setError(null)}
                className="hover:opacity-80 transition-all transform hover:scale-110"
              >
                <svg
                  className="w-5 h-5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Main Content */}
        <div
          className={`flex-1 flex flex-col overflow-hidden min-h-0 bg-gray-50 dark:bg-slate-900 ${activeTab === "delivery" || activeTab === "notes" || activeTab === "puller" || activeTab === "preorder" || activeTab === "stock-back" || activeTab === "access" ? "" : "overflow-y-auto"}`}
        >
          <div
            className={`relative flex-1 flex flex-col min-h-0 ${activeTab === "delivery" ? "p-2 overflow-hidden" : activeTab === "notes" || activeTab === "puller" || activeTab === "preorder" || activeTab === "stock-back" || activeTab === "access" ? "px-6 py-6 overflow-hidden" : "px-6 py-6"}`}
          >
            <div
              className={`flex gap-6 ${activeTab === "delivery" || activeTab === "puller" || activeTab === "preorder" || activeTab === "stock-back" ? "flex-1 min-h-0 overflow-hidden" : "h-full"}`}
            >
                {/* Left Sidebar - Job Summary - Hidden on Delivery and Puller; shows for Purchase Order, Access, Notes at 1366px+ */}
                {selectedJobNumber &&
                  canAccessActiveTab &&
                  displayedLineItems.length > 0 &&
                  activeTab !== "delivery" &&
                  activeTab !== "puller" &&
                  activeTab !== "preorder" &&
                  activeTab !== "stock-back" &&
                  (
                    <div className="hidden sidebar:block w-64 flex-shrink-0 overflow-visible">
                      <div className="sticky top-6 overflow-visible">
                        <JobSummary
                          lineItems={displayedLineItems}
                          showUnpulledOnly={showUnpulledOnly}
                          onToggleFilter={() =>
                            setShowUnpulledOnly(!showUnpulledOnly)
                          }
                          hasUnsavedChanges={hasUnsavedChanges}
                          jobPreorderOpenByPart={jobPreorderOpenByPart}
                        />
                      </div>
                    </div>
                  )}

                {/* Content Area */}
                <div
                  className={`flex-1 min-w-0 ${activeTab === "delivery" || activeTab === "puller" || activeTab === "preorder" || activeTab === "stock-back" ? "flex flex-col min-h-0 overflow-hidden" : ""}`}
                >
                  {!selectedJobNumber ? (
                    <div className="bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl p-12 text-center backdrop-blur-sm shadow-xl">
                      <div className="relative inline-block">
                        <div className="absolute inset-0 bg-blue-500 rounded-full opacity-20 animate-ping"></div>
                        <svg
                          className="w-20 h-20 text-blue-500 dark:text-blue-400 mx-auto mb-6 relative z-10"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
                          />
                        </svg>
                      </div>
                      <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-3">
                        Select a Job to Get Started
                      </h2>
                      <p className="text-slate-500 dark:text-slate-400 font-medium text-lg">
                        Use the job selector on the left to view and manage line
                        items.
                      </p>
                    </div>
                  ) : !canAccessActiveTab || isJobAccessDenied ? (
                      <div className="min-h-[18rem] rounded-xl border border-slate-200 bg-white/70 dark:border-slate-700/50 dark:bg-slate-800/40" />
                  ) : activeTab === "notes" ? (
                    <NotesTab
                      jobNumber={selectedJobNumber}
                      jobName={
                        displayedLineItems[0]?.jobName ||
                        currentJobName ||
                        jobs.find((j) => j.jobNumber === selectedJobNumber)
                          ?.jobName ||
                        ""
                      }
                      listNumberContext={listNumberContext}
                      openNoteId={openNoteId}
                      onDeepLinkConsumed={clearNoteDeepLink}
                      canAddEditNotes={canAddEditNotes}
                      canDeleteNotes={canDeleteNotes}
                      canUploadPackingSlips={canUploadPackingSlips}
                    />
                  ) : activeTab === "access" ? (
                    <AccessTab
                      jobNumber={selectedJobNumber}
                      jobName={
                        displayedLineItems[0]?.jobName ||
                        currentJobName ||
                        jobs.find((j) => j.jobNumber === selectedJobNumber)
                          ?.jobName ||
                        ""
                      }
                      listNumberContext={listNumberContext}
                      canManageOverride={canManageJobAccess}
                      isServiceJob={deliveryRecord?.isServiceJob ?? false}
                    />
                  ) : activeTab === "puller" ? (
                    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                      <div className="flex-shrink-0 mb-4">
                        <JobSummary
                          lineItems={displayedLineItems}
                          showUnpulledOnly={showUnpulledOnly}
                          onToggleFilter={handleShowUnpulledOnlyToggle}
                          hasUnsavedChanges={hasUnsavedChanges}
                          variant="bar"
                          activeFilter={lineFilter}
                          onFilterChange={handleOverviewFilterChange}
                          showOnlyReceived={showOnlyReceived}
                          onToggleOnlyReceived={handleShowOnlyReceivedToggle}
                          jobPreorderOpenByPart={jobPreorderOpenByPart}
                        />
                      </div>
                      <JobItemsTable
                        lineItems={filteredLineItems}
                        bulkActionLineItems={displayedLineItems}
                        showUnpulledOnly={showUnpulledOnly}
                        activeFilter={lineFilter}
                        onSave={handleSave}
                        isSaving={isSaving}
                        onAddLineItem={() => setShowAddLineModal(true)}
                        onEditJob={() => setShowEditJobModal(true)}
                        onDeleteJob={() => setShowDeleteConfirmModal(true)}
                        onDeleteLineItem={handleDeleteLineItem}
                        onToolbarData={setToolbarData}
                        onUnsavedChangesChange={setHasUnsavedChanges}
                        registerSaveHandler={registerTabSaveHandler}
                        canEditOverride={
                          canPullFromShop || canOrderLineItems || canEditLineItems
                        }
                        canPullFromShopOverride={canPullFromShop}
                        canOrderItemsOverride={canOrderLineItems}
                        canEditLineItemsOverride={canEditLineItems}
                        canDeleteLineItemsOverride={canDeleteLineItems}
                        canAddLineItemsOverride={canAddLineItems}
                        emptyStateActions={
                          selectedJobNumber && lineItems.length === 0 ? (
                            <JobPdfUpdateImportLauncher
                              jobNumber={selectedJobNumber}
                              jobName={currentJobDisplayName}
                              listNumberContext={listNumberContext}
                              canEdit={canImportUpdatePdf && !isSaving}
                              triggerLabel="Upload Picksheets"
                              triggerClassName="px-5 py-2.5 rounded-xl font-semibold text-sm shadow-lg transition-all bg-slate-700 hover:bg-slate-800 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                          ) : null
                        }
                        itemsInPurchaseOrders={itemsInPurchaseOrders}
                        discardChangesSignal={overviewDiscardSignal}
                        listNumber={listParam ?? displayedLineItems[0]?.listNumber ?? null}
                        jobPreorderPoolAvailable={jobPreorderPoolAvailable}
                        jobPreorderOpenByPart={jobPreorderOpenByPart}
                      />
                    </div>
                  ) : activeTab === "delivery" ? (
                    <DeliveryTab
                      jobNumber={selectedJobNumber}
                      jobName={
                        displayedLineItems[0]?.jobName ||
                        currentJobName ||
                        jobs.find((j) => j.jobNumber === selectedJobNumber)
                          ?.jobName ||
                        ""
                      }
                      lineItems={displayedLineItems}
                        jobMeta={jobMeta}
                        listNumber={
                          listParam ??
                          displayedLineItems[0]?.listNumber ??
                          jobMeta?.listNumber ??
                          null
                        }
                      listNumberContext={deliveryListContext}
                      isSaving={isSaving}
                      canEditOverride={canEditDeliveryDetails}
                      canMarkDeliveredOverride={canMarkDelivered}
                      canMarkPickupOverride={canMarkPickup}
                      canPartialDeliveryOverride={canRecordPartialDelivery}
                      canShowEditJobButtonOverride={canEditJobInfo}
                      onEditJob={() => setShowEditJobModal(true)}
                      onUnsavedChangesChange={setHasDeliveryUnsavedChanges}
                      registerSaveHandler={registerTabSaveHandler}
                      onPickupConfirmed={async () => {
                        if (selectedJobNumber) await loadJobLineItems(selectedJobNumber);
                      }}
                    />
                  ) : activeTab === "stock-back" ? (
                    <JobStockBackTab
                      jobNumber={selectedJobNumber}
                      canCreateStockIn={canCreateStockIn}
                      canUndoStockIn={canUndoStockIn}
                      onInventoryChanged={() => {
                        void loadJobLineItems(selectedJobNumber);
                      }}
                    />
                  ) : activeTab === "preorder" && jobPreorderFeaturesEnabled ? (
                    <JobPreorderTab
                      jobNumber={selectedJobNumber}
                      jobLineItems={lineItems}
                      canEdit={canEditPreorder}
                      onInventoryChanged={() => {
                        void refreshJobPreorderTotals();
                        if (selectedJobNumber) {
                          void loadJobLineItems(selectedJobNumber);
                        }
                      }}
                    />
                  ) : (
                    <PurchaseOrderTab
                      jobNumber={selectedJobNumber}
                      jobName={
                        displayedLineItems[0]?.jobName ||
                        currentJobName ||
                        jobs.find((j) => j.jobNumber === selectedJobNumber)
                          ?.jobName ||
                        ""
                      }
                      lineItems={displayedLineItems}
                      listNumberContext={
                        listNumberContext === LIST_CONTEXT_ALL
                          ? null
                          : listNumberContext
                      }
                      onManualCostSaved={(rowIndex, manualCost) => {
                        setLineItems((prev) =>
                          prev.map((item) =>
                            item.rowIndex === rowIndex
                              ? { ...item, manualCost }
                              : item,
                          ),
                        );
                      }}
                      purchaseOrderAccountedFor={
                        jobMeta?.purchaseOrderAccountedFor ?? false
                      }
                      onJobMetaUpdated={(meta) => setJobMeta(meta)}
                      canEditUnitCost={canEditPurchaseOrderUnitCost}
                    />
                  )}
                </div>
              </div>

            {showJobBootLoader ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-50 dark:bg-slate-900">
                <JobPageBootLoader message={jobBootLoaderMessage} />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Unsaved Changes Modal */}
      {showUnsavedOverviewModal &&
        (pendingTabChange ||
          pendingRouteChange ||
          pendingBrowserBack ||
          pendingOverviewActionLabel) && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          style={{ zIndex: 10001 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleCancelUnsavedOverviewModal();
            }
          }}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-700/50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center mb-4">
              <div className="w-14 h-14 bg-amber-100 dark:bg-amber-500/20 rounded-full flex items-center justify-center">
                <svg
                  className="w-7 h-7 text-amber-600 dark:text-amber-300"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-8.938 4h17.876c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
            </div>

            <h2 className="text-xl font-bold text-slate-900 dark:text-white text-center mb-2">
              Unsaved {unsavedContextLabel} Changes
            </h2>
            <p className="text-slate-600 dark:text-slate-300 text-center mb-6">
              {pendingTabChange
                ? `You have unsaved changes in ${unsavedContextLabel}. Save before leaving this tab?`
                : pendingOverviewActionLabel
                  ? `You have unsaved changes in ${unsavedContextLabel}. Save before you ${pendingOverviewActionLabel}?`
                  : `You have unsaved changes in ${unsavedContextLabel}. Save before leaving this page?`}
            </p>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleCancelUnsavedOverviewModal}
                disabled={isSavingBeforeLeave}
                className="flex-1 px-4 py-3 bg-slate-200 dark:bg-slate-700/50 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDiscardOverviewChanges}
                disabled={isSavingBeforeLeave}
                className="flex-1 px-4 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={handleSaveOverviewChanges}
                disabled={isSavingBeforeLeave}
                className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSavingBeforeLeave ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Line Item Modal */}
      {showAddLineModal && (
        <AddLineItemModal
          onClose={() => setShowAddLineModal(false)}
          onSubmit={handleAddLineItem}
          isSubmitting={isAddingLine}
          jobNumber={selectedJobNumber}
          listNumber={listNumberContext}
        />
      )}

      {/* Edit Job Modal */}
      {showEditJobModal && (
        <EditJobModal
          jobNumber={selectedJobNumber || ""}
          partNumber={displayedLineItems[0]?.partNumber || null}
          initialData={{
            jobName:
              displayedLineItems[0]?.jobName ||
              currentJobName ||
              jobs.find((j) => j.jobNumber === selectedJobNumber)?.jobName ||
              "",
            listNumber:
              listParam?.trim() ||
              displayedLineItems[0]?.listNumber ||
              jobMeta?.listNumber ||
              jobs.find((j) => j.jobNumber === selectedJobNumber)?.listNumbers?.[0] ||
              null,
            area: displayedLineItems[0]?.area || jobMeta?.area || null,
            locationShipTo:
              displayedLineItems[0]?.location || jobMeta?.locationShipTo || null,
            stocklistDeliveryShipDate:
              displayedLineItems[0]?.stocklistDate ||
              jobMeta?.stocklistDeliveryShipDate ||
              null,
            listedBy: displayedLineItems[0]?.listedBy || jobMeta?.listedBy || null,
            isServiceJob: deliveryRecord?.isServiceJob ?? false,
          }}
          onClose={() => {
            setShowEditJobModal(false);
            setError(null);
          }}
          onSubmit={handleUpdateJobInfo}
          onGoToAccess={() => {
            setShowEditJobModal(false);
            setActiveTab("access");
          }}
          isSubmitting={isUpdatingJob}
        />
      )}

      {/* Delete Job Confirmation Modal */}
      {showDeleteConfirmModal && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          style={{ zIndex: 9999 }}
          onClick={(e) => {
            // Close modal when clicking backdrop (but not when clicking the modal content itself)
            if (e.target === e.currentTarget && !isDeleting) {
              setShowDeleteConfirmModal(false);
              setError(null);
            }
          }}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-700/50 relative"
            style={{ zIndex: 10000 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Warning Icon */}
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-red-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
            </div>

            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2 text-center">
              {listParam && listParam.trim() ? "Delete This List?" : "Delete Job?"}
            </h2>
            <p className="text-slate-600 dark:text-slate-400 mb-6 text-center">
              {listParam && listParam.trim() ? (
                <>
                  Are you sure you want to delete list{" "}
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {listParam}
                  </span>{" "}
                  for job{" "}
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {selectedJobNumber}
                  </span>
                  ? Only this list&apos;s line items will be removed; other lists and job-level data (notes, delivery, etc.) are not affected.
                </>
              ) : (
                <>
                  Are you sure you want to delete job{" "}
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {selectedJobNumber}
                  </span>
                  ?
                </>
              )}
            </p>

            {/* Error message display */}
            {error && (
              <div className="bg-red-500/20 border border-red-500/50 rounded-xl p-4 mb-4">
                <p className="text-sm text-red-300 font-medium">
                  Error: {error}
                </p>
              </div>
            )}

            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6">
              <p className="text-sm text-red-300 font-medium">
                This action cannot be undone. This will permanently delete:
              </p>
              <ul className="mt-2 text-xs text-red-200/80 space-y-1 list-disc list-inside">
                {listParam && listParam.trim() ? (
                  <>
                    <li>All line items for list {listParam} only</li>
                  </>
                ) : (
                  <>
                    <li>All line items for this job</li>
                    <li>All notes</li>
                    <li>All delivery records</li>
                    <li>All notifications</li>
                  </>
                )}
              </ul>
            </div>

            <div className="mb-6 space-y-3">
                {!listParam || !listParam.trim() ? (
                isLoadingPulledSummary ? (
                  <div className="bg-slate-100 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-600/60 rounded-xl p-3 text-xs text-slate-600 dark:text-slate-300">
                    Checking for pulled parts for this job...
                  </div>
                ) : pulledSummary && pulledSummary.parts && pulledSummary.parts.length > 0 ? (
                  <>
                    <div className="bg-slate-100 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-600/60 rounded-xl p-3 text-xs text-slate-100">
                      <p className="font-semibold mb-1 text-slate-900 dark:text-slate-100">
                        Pulled parts for this job
                      </p>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300">
                        These quantities can be returned to inventory when you delete the job.
                      </p>
                      <div className="mt-2 max-h-32 overflow-y-auto rounded-lg bg-slate-900/40 border border-slate-700/60 p-2">
                        <table className="w-full text-[11px] text-left text-slate-100">
                          <thead>
                            <tr className="text-slate-300">
                              <th className="pr-2 pb-1 font-semibold">Part</th>
                              <th className="pr-2 pb-1 font-semibold">Description</th>
                              <th className="pb-1 font-semibold text-right">Qty to add back</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pulledSummary.parts.map((p) => (
                              <tr key={p.partId} className="border-t border-slate-700/40">
                                <td className="pr-2 py-1 font-mono">{p.partNumber || "-"}</td>
                                <td className="pr-2 py-1 truncate max-w-[12rem]">
                                  {p.description || "-"}
                                </td>
                                <td className="py-1 text-right font-semibold">
                                  {p.totalPulled}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <div className="space-y-2 text-xs text-slate-200">
                      <p className="font-semibold">Inventory behavior</p>
                      <div className="space-y-2">
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="delete-job-inventory-behavior"
                            className="mt-[3px] h-3 w-3 text-blue-500 border-slate-400"
                            checked={addBackInventory}
                            onChange={() => setAddBackInventory(true)}
                          />
                          <span>
                            <span className="font-semibold">Return parts to inventory</span>
                            <span className="block text-[11px] text-slate-300">
                              Adds back all pulled quantities shown above.
                            </span>
                          </span>
                        </label>
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="delete-job-inventory-behavior"
                            className="mt-[3px] h-3 w-3 text-blue-500 border-slate-400"
                            checked={!addBackInventory}
                            onChange={() => setAddBackInventory(false)}
                          />
                          <span>
                            <span className="font-semibold">Leave inventory as-is</span>
                            <span className="block text-[11px] text-slate-300">
                              Deletes the job but does not change on-hand counts.
                            </span>
                          </span>
                        </label>
                      </div>
                    </div>
                  </>
                ) : null
                ) : null}
              </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirmModal(false);
                  setError(null);
                }}
                disabled={isDeleting}
                className="flex-1 px-4 py-3 bg-slate-200 dark:bg-slate-700/50 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteJob}
                disabled={isDeleting}
                className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold transition-all shadow-lg shadow-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <svg
                      className="w-5 h-5 animate-spin"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    Deleting...
                  </>
                ) : (
                  "Delete Job"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    {isJobAccessDenied && (
      <AccessDeniedOverlay message="You do not have permission to view this job." />
    )}
    </>
  );
}

// Add Line Item Modal Component
function AddLineItemModal({
  onClose,
  onSubmit,
  isSubmitting,
  jobNumber,
  listNumber,
}: {
  onClose: () => void;
  onSubmit: (item: {
    partNumber: string;
    description: string;
    uom: string;
    quantityNeeded: number;
    type: string;
  }) => Promise<void>;
  isSubmitting: boolean;
  jobNumber?: string | null;
  listNumber?: string | null;
}) {
  const [partNumber, setPartNumber] = useState("");
  const [description, setDescription] = useState("");
  const [uom, setUom] = useState("");
  const [quantityNeeded, setQuantityNeeded] = useState(1);
  const [vendor, setVendor] = useState("");
  const [customVendor, setCustomVendor] = useState("");
  const [allVendors, setAllVendors] = useState<string[]>([]);
  const [isLoadingPartDetails, setIsLoadingPartDetails] = useState(false);
  const [databaseVendor, setDatabaseVendor] = useState<string | null>(null);
  const [showVendorWarning, setShowVendorWarning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch all vendors on mount
  useEffect(() => {
    const fetchAllVendors = async () => {
      try {
        const response = await fetch("/api/parts/vendors");
        if (response.ok) {
          const data = await response.json();
          setAllVendors(data.vendors || []);
        }
      } catch (err) {
        console.error("Error fetching vendors list:", err);
      }
    };

    fetchAllVendors();
  }, []);

  // Fetch part details when part number changes
  useEffect(() => {
    const fetchPartDetails = async () => {
      if (!partNumber || !partNumber.trim()) {
        setDatabaseVendor(null);
        return;
      }

      setIsLoadingPartDetails(true);
      try {
        const response = await fetch(
          `/api/parts/details?partNumber=${encodeURIComponent(partNumber)}`,
        );
        if (response.ok) {
          const data = await response.json();
          if (data.found) {
            // Store database vendor for comparison
            setDatabaseVendor(data.type || null);

            // Auto-populate description, UOM, and vendor
            if (data.description) {
              setDescription(data.description);
            }
            if (data.unitOfMeasurement) {
              setUom(data.unitOfMeasurement);
            }
            if (data.type) {
              const vendorKey = normalizeVendorKey(data.type);
              // Check if vendor is in the allVendors list
              if (allVendors.length > 0 && allVendors.includes(vendorKey)) {
                setVendor(vendorKey);
                setCustomVendor("");
              } else if (vendorKey) {
                // Custom vendor - set to "Other" and store custom value
                setVendor("Other");
                setCustomVendor(vendorKey);
              }
            }
          } else {
            // Part not found in database, clear database vendor
            setDatabaseVendor(null);
          }
        }
      } catch (err) {
        console.error("Error fetching part details:", err);
      } finally {
        setIsLoadingPartDetails(false);
      }
    };

    // Debounce the API call
    const timeoutId = setTimeout(() => {
      fetchPartDetails();
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [partNumber, allVendors]);

  // Get the actual vendor value (from dropdown or custom)
  const getVendorValue = () => {
    if (vendor === "Other") {
      return customVendor;
    }
    return vendor;
  };

  // Check for vendor mismatch
  const checkVendorMismatch = (): boolean => {
    if (!databaseVendor || !partNumber.trim()) {
      return false; // No database vendor or no part number, no mismatch
    }

    const selectedVendor = getVendorValue();
    if (!selectedVendor || selectedVendor.trim() === "") {
      return false; // No vendor selected, no mismatch
    }

    // Compare selected vendor with database vendor (case-insensitive)
    return normalizeVendorKey(selectedVendor) !== normalizeVendorKey(databaseVendor);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); // Clear any previous errors

    // Validate quantity needed
    if (quantityNeeded <= 0) {
      setError("Quantity Needed must be greater than 0");
      return;
    }

    // Check for vendor mismatch
    if (checkVendorMismatch()) {
      setShowVendorWarning(true);
      return;
    }

    // No mismatch, proceed with submission
    try {
      await onSubmit({
        partNumber,
        description,
        uom,
        quantityNeeded,
        type: normalizeVendorKey(getVendorValue()),
      });
      // If successful, the parent will close the modal
    } catch (err) {
      // Display error in the modal
      setError((err as Error).message || "Failed to add part");
    }
  };

  const handleConfirmSubmit = async () => {
    setShowVendorWarning(false);
    setError(null); // Clear any previous errors

    // Validate quantity needed
    if (quantityNeeded <= 0) {
      setError("Quantity Needed must be greater than 0");
      return;
    }

    try {
      await onSubmit({
        partNumber,
        description,
        uom,
        quantityNeeded,
        type: normalizeVendorKey(getVendorValue()),
      });
      // If successful, the parent will close the modal
    } catch (err) {
      // Display error in the modal
      setError((err as Error).message || "Failed to add part");
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        {/* Backdrop */}
        <div
          className="fixed inset-0 transition-opacity bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* Modal */}
        <div className="inline-block align-bottom bg-white dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700/50 rounded-2xl text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full backdrop-blur-sm">
          <form onSubmit={handleSubmit}>
            <div className="bg-white dark:bg-slate-800/60 px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-6">Add Part</h3>

              {/* Error Message */}
              {error && (
                <div className="mb-4 p-4 bg-red-900/30 border border-red-500/50 rounded-xl">
                  <div className="flex items-start">
                    <div className="flex-shrink-0">
                      <svg
                        className="h-5 w-5 text-red-400"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                    <div className="ml-3 flex-1">
                      <h4 className="text-sm font-semibold text-red-400 mb-1">
                        Error Adding Part
                      </h4>
                      <p className="text-sm text-red-300">{error}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setError(null)}
                      className="ml-4 flex-shrink-0 text-red-400 hover:text-red-300"
                    >
                      <svg
                        className="h-5 w-5"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2">
                    Part Number *
                  </label>
                  <PartSearchCombobox
                    value={partNumber}
                    onChange={(v) => {
                      setPartNumber(v);
                      setError(null);
                    }}
                    onPartSelect={(part) => setPartNumber(part.pn)}
                    placeholder="Search by part number or description..."
                    required
                    showLoadingIndicator={isLoadingPartDetails}
                    permissionContext={{ jobNumber, listNumber }}
                    className="[&_input]:py-3 [&_input]:bg-slate-50 [&_input]:dark:bg-slate-700/50"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2">
                    Description *
                  </label>
                  <input
                    type="text"
                    required
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium placeholder:text-slate-500"
                    placeholder="Enter description"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2">
                      UOM *
                    </label>
                    <input
                      type="text"
                      required
                      value={uom}
                      onChange={(e) => setUom(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium placeholder:text-slate-500"
                      placeholder="EA, FT, etc."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2">
                      Quantity Needed *
                    </label>
                    <input
                      type="number"
                      required
                      min="1"
                      value={quantityNeeded}
                      onChange={(e) => {
                        const value = parseInt(e.target.value) || 0;
                        setQuantityNeeded(value > 0 ? value : 1);
                        setError(null); // Clear error when user changes quantity
                      }}
                      className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2">
                    Vendor
                  </label>
                  <select
                    value={vendor}
                    onChange={(e) => {
                      setVendor(e.target.value);
                      if (e.target.value !== "Other") {
                        setCustomVendor("");
                      }
                    }}
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium"
                  >
                    <option value="">Select a vendor...</option>
                    {allVendors.map((vendorOption) => (
                      <option key={vendorOption} value={vendorOption}>
                        {formatVendorDisplay(vendorOption)}
                      </option>
                    ))}
                    <option value="Other">Other</option>
                  </select>
                  {/* Show custom vendor input when "Other" is selected */}
                  {vendor === "Other" && (
                    <input
                      type="text"
                      value={customVendor}
                      onChange={(e) => setCustomVendor(e.target.value)}
                      placeholder="Enter vendor name"
                      className="w-full mt-2 px-4 py-3 bg-slate-50 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium placeholder:text-slate-500"
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="bg-slate-50 dark:bg-slate-800/80 px-4 py-4 sm:px-6 sm:flex sm:flex-row-reverse gap-3 border-t border-slate-200 dark:border-slate-700">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full sm:w-auto px-6 py-3 bg-blue-500 text-white rounded-xl font-semibold hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-500/20"
              >
                {isSubmitting ? "Adding..." : "Add Part"}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="mt-3 sm:mt-0 w-full sm:w-auto px-6 py-3 bg-slate-200 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600/50 text-slate-700 dark:text-slate-300 rounded-xl font-semibold hover:bg-slate-300 dark:hover:bg-slate-700/70 hover:text-slate-900 dark:hover:text-white disabled:cursor-not-allowed transition-all"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Vendor Mismatch Warning Modal */}
      {showVendorWarning && databaseVendor && (
        <div className="fixed inset-0 z-[60] overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            {/* Backdrop */}
            <div
              className="fixed inset-0 transition-opacity bg-black/50 backdrop-blur-sm"
              onClick={() => setShowVendorWarning(false)}
            />

            {/* Modal */}
            <div className="inline-block align-bottom bg-white dark:bg-slate-800/90 border border-yellow-500/50 rounded-2xl text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full backdrop-blur-sm">
              <div className="bg-white dark:bg-slate-800/60 px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="flex items-start mb-4">
                  <div className="flex-shrink-0">
                    <svg
                      className="h-6 w-6 text-yellow-500 dark:text-yellow-400"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <div className="ml-3 flex-1">
                    <h3 className="text-xl font-bold text-yellow-600 dark:text-yellow-400 mb-2">
                      Vendor Mismatch Detected
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
                      The vendor you selected does not match the vendor in the
                      database for this part number.
                    </p>

                    {/* Mismatch Details */}
                    <div className="bg-slate-100 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-700/50 p-4 mb-4">
                      <div className="space-y-2 text-sm">
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">Part Number:</span>{" "}
                          <span className="font-mono font-semibold text-slate-900 dark:text-white">
                            {partNumber}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">
                            Database Vendor:
                          </span>{" "}
                          <span className="text-slate-600 dark:text-slate-300">
                            {databaseVendor}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">Your Vendor:</span>{" "}
                          <span className="font-bold text-yellow-600 dark:text-yellow-400">
                            {getVendorValue()}
                          </span>
                        </div>
                      </div>
                    </div>

                    <p className="text-xs text-slate-500 dark:text-slate-400 italic">
                      Click "Continue Anyway" to add the part with your vendor
                      selection, or "Cancel" to review and adjust the vendor.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/40 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse gap-3 border-t border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={handleConfirmSubmit}
                  disabled={isSubmitting}
                  className="w-full sm:w-auto px-4 py-2 bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-white rounded-xl font-semibold transition-all shadow-lg shadow-yellow-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Continue Anyway
                </button>
                <button
                  type="button"
                  onClick={() => setShowVendorWarning(false)}
                  disabled={isSubmitting}
                  className="mt-3 sm:mt-0 w-full sm:w-auto px-4 py-2 bg-slate-200 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600/50 text-slate-700 dark:text-slate-300 rounded-xl font-semibold hover:bg-slate-300 dark:hover:bg-slate-700/70 hover:text-slate-900 dark:hover:text-white disabled:cursor-not-allowed transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Edit Job Modal Component
function EditJobModal({
  jobNumber,
  partNumber,
  initialData,
  onClose,
  onSubmit,
  onGoToAccess,
  isSubmitting,
}: {
  jobNumber: string;
  partNumber: string | null;
  initialData: {
    jobName: string;
    listNumber?: string | null;
    area?: string | null;
    locationShipTo?: string | null;
    stocklistDeliveryShipDate?: string | null;
    listedBy?: string | null;
    isServiceJob?: boolean;
  };
  onClose: () => void;
  onSubmit: (data: {
    jobNumber?: string;
    jobName: string;
    listNumber?: string | null;
    area?: string | null;
    locationShipTo?: string | null;
    stocklistDeliveryShipDate?: string | null;
    listedBy?: string | null;
    deliveryDate?: string;
    deliveryDateChangeNote?: string | null;
    isServiceJob?: boolean;
    accessTypeChangeConfirmed?: boolean;
  }) => Promise<void>;
  onGoToAccess?: () => void;
  isSubmitting: boolean;
}) {
  const [jobNumberValue, setJobNumberValue] = useState(jobNumber);
  const [jobName, setJobName] = useState(initialData.jobName);
  const [listNumber, setListNumber] = useState(initialData.listNumber || "");
  const [area, setArea] = useState(initialData.area || "");
  const [locationShipTo, setLocationShipTo] = useState(
    initialData.locationShipTo || "",
  );
  const [stocklistDeliveryShipDate, setStocklistDeliveryShipDate] = useState(
    initialData.stocklistDeliveryShipDate || "",
  );
  const [listedBy, setListedBy] = useState(initialData.listedBy || "");
  const [listedByInput, setListedByInput] = useState("");
  const [listedByDropdownOpen, setListedByDropdownOpen] = useState(false);
  const listedByContainerRef = useRef<HTMLDivElement>(null);
  const [isServiceJob, setIsServiceJob] = useState(initialData.isServiceJob ?? false);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [initialDeliveryDate, setInitialDeliveryDate] = useState("");
  const [deliveryDateChangeNote, setDeliveryDateChangeNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [accessReview, setAccessReview] = useState<JobTypeAccessReview | null>(null);
  const [canConfirmAccessReview, setCanConfirmAccessReview] = useState(false);
  const [isLoadingDates, setIsLoadingDates] = useState(true);
  const [users, setUsers] = useState<
    Array<{ email: string; name: string | null }>
  >([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);

  // Load users for Listed By combobox
  useEffect(() => {
    const loadUsers = async () => {
      try {
        setIsLoadingUsers(true);
        const response = await fetch("/api/users/for-access");
        if (!response.ok) {
          throw new Error("Failed to load users");
        }
        const data = await response.json();
        setUsers(data.users || []);
      } catch (err) {
        console.error("Error loading users:", err);
      } finally {
        setIsLoadingUsers(false);
      }
    };

    loadUsers();
  }, []);

  // Sync listedByInput with listedBy when users first load (show name for current email)
  const listedBySyncedRef = useRef(false);
  useEffect(() => {
    if (users.length === 0 || listedBy === "") return;
    if (!listedBySyncedRef.current) {
      listedBySyncedRef.current = true;
      const match = users.find((u) => u.email === listedBy);
      setListedByInput(match ? (match.name || match.email) : listedBy);
    }
  }, [users, listedBy]);

  // Filter users by typed name or email (case-insensitive)
  const listedByFilteredUsers = useMemo(() => {
    const q = listedByInput.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        (u.name || "").toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q),
    );
  }, [users, listedByInput]);

  // Close Listed By dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        listedByContainerRef.current &&
        !listedByContainerRef.current.contains(e.target as Node)
      ) {
        setListedByDropdownOpen(false);
        // Restore input to current selection display
        if (listedBy && users.length > 0) {
          const match = users.find((u) => u.email === listedBy);
          setListedByInput(match ? (match.name || match.email) : listedBy);
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [listedBy, users]);

  // Fetch deliveryDate from the database (use current list so dates load for the list being edited)
  const currentListForDates = initialData.listNumber ?? "1";
  useEffect(() => {
    const fetchJobDates = async () => {
      try {
        const params = new URLSearchParams();
        params.set("listNumber", String(currentListForDates));
        if (partNumber && partNumber.trim().length > 0) {
          params.set("partNumber", partNumber.trim());
        }
        const response = await fetch(
          `/api/jobs/${jobNumber}/get-dates?${params.toString()}`,
        );
        if (response.ok) {
          const data = await response.json();
          const loadedDelivery =
            data.deliveryDate || new Date().toISOString().split("T")[0];
          setDeliveryDate(loadedDelivery);
          setInitialDeliveryDate(loadedDelivery);
          if (typeof data.listedBy === "string" && data.listedBy.trim().length > 0) {
            setListedBy(data.listedBy);
          }
        } else {
          const today = new Date().toISOString().split("T")[0];
          setDeliveryDate(today);
          setInitialDeliveryDate(today);
        }
      } catch (err) {
        console.error("Error fetching job dates:", err);
        const today = new Date().toISOString().split("T")[0];
        setDeliveryDate(today);
        setInitialDeliveryDate(today);
      } finally {
        setIsLoadingDates(false);
      }
    };

    if (jobNumber) {
      fetchJobDates();
    }
  }, [jobNumber, partNumber, currentListForDates]);

  const submitForm = async (accessTypeChangeConfirmed: boolean) => {
    setError(null);

    if (!jobNumberValue.trim()) {
      setError("Job Number is required");
      return;
    }

    if (!jobName.trim()) {
      setError("Job Name is required");
      return;
    }

    try {
      await onSubmit({
        jobNumber: jobNumberValue.trim(),
        jobName: jobName.trim(),
        listNumber: listNumber.trim() || null,
        area: area.trim() || null,
        locationShipTo: locationShipTo.trim() || null,
        stocklistDeliveryShipDate: stocklistDeliveryShipDate || null,
        listedBy: listedBy.trim() || null,
        deliveryDate: deliveryDate || new Date().toISOString().split("T")[0],
        deliveryDateChangeNote:
          deliveryDate !== initialDeliveryDate
            ? deliveryDateChangeNote.trim() || null
            : null,
        isServiceJob,
        accessTypeChangeConfirmed,
      });
    } catch (err) {
      const reviewError = err as JobTypeAccessReviewError;
      if (reviewError.accessReview) {
        setAccessReview(reviewError.accessReview);
        setCanConfirmAccessReview(reviewError.canConfirm === true);
        setError(null);
        return;
      }
      setError(reviewError.message);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAccessReview(null);
    setCanConfirmAccessReview(false);
    await submitForm(false);
  };

  const displayReviewUser = (user: JobTypeAccessReviewUser) =>
    user.name ? `${user.name} (${user.email})` : user.email;

  const reviewSourceLabel = (source: string) => {
    if (source === "AUTO_ALL_JOBS") return "Auto";
    if (source === "CREATOR") return "Creator";
    if (source === "INITIAL_GRANT") return "Initial";
    return "Manual";
  };

  const renderReviewList = (users: JobTypeAccessReviewUser[]) => (
    <ul className="mt-2 space-y-1.5">
      {users.map((user) => (
        <li
          key={`${user.source}:${user.email}`}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-xs dark:bg-slate-800/70"
        >
          <span className="font-semibold text-slate-700 dark:text-slate-200">
            {displayReviewUser(user)}
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
            {reviewSourceLabel(user.source)}
          </span>
        </li>
      ))}
    </ul>
  );

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-gray-200 dark:border-slate-700/50 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700/50 px-6 py-4 z-10">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
              Edit Job Information
            </h2>
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors disabled:opacity-50"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 bg-white dark:bg-slate-800">
          {isLoadingDates && (
            <div className="bg-blue-50 dark:bg-blue-500/20 border border-blue-200 dark:border-blue-500/50 rounded-xl p-4">
              <p className="text-sm text-blue-700 dark:text-blue-300 font-medium">
                Loading job dates...
              </p>
            </div>
          )}
          {error && !accessReview && (
            <div className="bg-red-50 dark:bg-red-500/20 border border-red-200 dark:border-red-500/50 rounded-xl p-4">
              <p className="text-sm text-red-700 dark:text-red-300 font-medium">
                Error: {error}
              </p>
            </div>
          )}
          {accessReview && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-600/50 dark:bg-amber-900/20">
              <h3 className="text-sm font-bold text-amber-900 dark:text-amber-100">
                Job access review required
              </h3>
              {accessReview.editorWouldLoseAccess ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-white/70 p-3 dark:border-amber-800/70 dark:bg-slate-900/30">
                  <p className="text-xs font-bold uppercase text-amber-800 dark:text-amber-200">
                    Your access may change
                  </p>
                  <p className="mt-1 text-sm text-amber-800 dark:text-amber-100">
                    You do not have visibility for the new job type. If you confirm, the change will save and you will be sent back to the jobs list.
                  </p>
                </div>
              ) : null}
              {accessReview.manualMismatches.length > 0 ? (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800/70 dark:bg-red-950/30">
                  <p className="text-xs font-bold uppercase text-red-700 dark:text-red-300">
                    Fix before saving
                  </p>
                  <p className="mt-1 text-sm text-red-700 dark:text-red-200">
                    These users have manual, creator, or initial access but do not have visibility for the new job type.
                  </p>
                  {renderReviewList(accessReview.manualMismatches)}
                </div>
              ) : null}
              {accessReview.autoRemoved.length > 0 ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-white/70 p-3 dark:border-amber-800/70 dark:bg-slate-900/30">
                  <p className="text-xs font-bold uppercase text-amber-800 dark:text-amber-200">
                    Auto access removed
                  </p>
                  {renderReviewList(accessReview.autoRemoved)}
                </div>
              ) : null}
              {accessReview.autoAdded.length > 0 ? (
                <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800/70 dark:bg-green-950/20">
                  <p className="text-xs font-bold uppercase text-green-700 dark:text-green-300">
                    Auto access added
                  </p>
                  {renderReviewList(accessReview.autoAdded)}
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                {accessReview.manualMismatches.length > 0 ? (
                  <button
                    type="button"
                    onClick={onGoToAccess}
                    disabled={isSubmitting || !onGoToAccess}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Go to Job Access
                  </button>
                ) : canConfirmAccessReview ? (
                  <button
                    type="button"
                    onClick={() => void submitForm(true)}
                    disabled={isSubmitting}
                    className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Confirm access changes
                  </button>
                ) : null}
              </div>
            </div>
          )}

          {/* Line 1: Job Number | Listed By */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-slate-600 dark:text-slate-300 mb-2">
                Job Number <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={jobNumberValue}
                onChange={(e) => {
                  setJobNumberValue(e.target.value);
                  setError(null);
                }}
                required
                disabled={isSubmitting}
                className="w-full px-4 py-2.5 bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-600/80 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder="Enter job number"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-600 dark:text-slate-300 mb-2">
                Listed By
              </label>
              <div className="relative" ref={listedByContainerRef}>
                <input
                  type="text"
                  value={listedByInput}
                  onChange={(e) => {
                    setListedByInput(e.target.value);
                    setListedByDropdownOpen(true);
                  }}
                  onFocus={() => setListedByDropdownOpen(true)}
                  onBlur={() => {
                    // Delay so click on option can fire first
                    setTimeout(() => {
                      if (listedByInput.trim() === "") {
                        setListedBy("");
                      } else if (listedBy && users.length > 0) {
                        const match = users.find((u) => u.email === listedBy);
                        setListedByInput(match ? (match.name || match.email) : listedBy);
                      }
                    }, 150);
                  }}
                  disabled={isSubmitting || isLoadingUsers}
                  placeholder={isLoadingUsers ? "Loading users..." : "Type to search by name or email..."}
                  className="w-full px-4 py-2.5 bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-600/80 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 shadow-sm hover:border-gray-400 dark:hover:border-slate-500/80 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  autoComplete="off"
                  role="combobox"
                  aria-expanded={listedByDropdownOpen}
                  aria-autocomplete="list"
                />
                {listedByDropdownOpen && !isLoadingUsers && (
                  <ul
                    className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-lg py-1"
                    role="listbox"
                  >
                    {listedByFilteredUsers.length === 0 ? (
                      <li className="px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400">
                        No matching users
                      </li>
                    ) : (
                      listedByFilteredUsers.map((user) => {
                        const display = user.name || user.email;
                        const isSelected = user.email === listedBy;
                        return (
                          <li
                            key={user.email}
                            role="option"
                            aria-selected={isSelected}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setListedBy(user.email);
                              setListedByInput(display);
                              setListedByDropdownOpen(false);
                            }}
                            className={`px-4 py-2.5 text-sm cursor-pointer select-none ${
                              isSelected
                                ? "bg-blue-100 dark:bg-blue-900/40 text-blue-900 dark:text-blue-100"
                                : "text-slate-900 dark:text-white hover:bg-gray-100 dark:hover:bg-slate-700/80"
                            }`}
                          >
                            {display}
                            {user.name && (
                              <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                                {user.email}
                              </span>
                            )}
                          </li>
                        );
                      })
                    )}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {/* Line 2: Description (Job Name) | List Number */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-slate-600 dark:text-slate-300 mb-2">
                Description <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={jobName}
                onChange={(e) => {
                  setJobName(e.target.value);
                  setError(null);
                }}
                required
                disabled={isSubmitting}
                className="w-full px-4 py-2.5 bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-600/80 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder="Enter job name"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-600 dark:text-slate-300 mb-2">
                List Number
              </label>
              <input
                type="text"
                value={listNumber}
                onChange={(e) => setListNumber(e.target.value)}
                disabled={isSubmitting}
                className="w-full px-4 py-2.5 bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-600/80 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 shadow-sm hover:border-gray-400 dark:hover:border-slate-500/80 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder="Optional"
              />
            </div>
          </div>

          {/* Service job */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="edit-job-service-job"
              checked={isServiceJob}
              onChange={(e) => {
                setIsServiceJob(e.target.checked);
                setAccessReview(null);
                setCanConfirmAccessReview(false);
                setError(null);
              }}
              disabled={isSubmitting}
              className="h-4 w-4 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 bg-white dark:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <label
              htmlFor="edit-job-service-job"
              className="text-sm font-bold text-slate-600 dark:text-slate-300 cursor-pointer select-none"
            >
              Service job
            </label>
          </div>

          {/* Line 3: Stocklist Date | Delivery Date */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-slate-600 dark:text-slate-300 mb-2">
                Stocklist Date <span className="text-red-400">*</span>
              </label>
              <input
                type="date"
                value={stocklistDeliveryShipDate}
                onChange={(e) => setStocklistDeliveryShipDate(e.target.value)}
                required
                disabled={isSubmitting}
                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-600/80 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed dark:[&::-webkit-calendar-picker-indicator]:invert"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-600 dark:text-slate-300 mb-2">
                Delivery Date <span className="text-red-400">*</span>
              </label>
              <input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                required
                disabled={isSubmitting || isLoadingDates}
                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-600/80 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed dark:[&::-webkit-calendar-picker-indicator]:invert"
              />
            </div>
          </div>

          {!isLoadingDates && deliveryDate !== initialDeliveryDate ? (
            <div>
              <label className="block text-sm font-bold text-slate-600 dark:text-slate-300 mb-2">
                Why is the delivery date changing?
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                Optional. The date change is always recorded in Notes; add a
                reason here to include it in the update email.
              </p>
              <textarea
                value={deliveryDateChangeNote}
                onChange={(e) => setDeliveryDateChangeNote(e.target.value)}
                disabled={isSubmitting}
                rows={3}
                placeholder="e.g. Customer requested a one-week push due to site access..."
                className="w-full px-4 py-2.5 bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-600/80 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 shadow-sm resize-y min-h-[80px] disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
          ) : null}

          {/* Line 4: Location | Area */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-slate-600 dark:text-slate-300 mb-2">
                Location / Ship To
              </label>
              <input
                type="text"
                value={locationShipTo}
                onChange={(e) => setLocationShipTo(e.target.value)}
                disabled={isSubmitting}
                className="w-full px-4 py-2.5 bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-600/80 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 shadow-sm hover:border-gray-400 dark:hover:border-slate-500/80 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-600 dark:text-slate-300 mb-2">
                Area
              </label>
              <input
                type="text"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                disabled={isSubmitting}
                className="w-full px-4 py-2.5 bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-600/80 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 shadow-sm hover:border-gray-400 dark:hover:border-slate-500/80 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-slate-700/50">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 px-4 py-3 bg-gray-100 dark:bg-slate-700/50 hover:bg-gray-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-all shadow-lg shadow-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <svg
                    className="w-5 h-5 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  Updating...
                </>
              ) : (
                "Update Job"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
