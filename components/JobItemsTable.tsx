"use client";

import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  type DragEvent,
  type ReactNode,
} from "react";
import { useAuth } from "@/lib/hooks/useAuth";
import { isJobPreorderEnabled } from "@/lib/featureFlags";
import type { JobLineItem } from "@/lib/types";
import {
  clampFab,
  getRemainingQty,
  getShopPullNeededQty,
  getVendorReceivedForRemaining,
  toNonNegativeInt,
} from "@/lib/quantityMath";
import { buildPoLineKey } from "@/lib/poLineKey";
import {
  formatVendorDisplay,
  normalizeVendorKey,
} from "@/lib/vendorUtils";
import type { LineFilter } from "@/lib/jobSummaryUtils";
import { jobPreorderPartKey } from "@/lib/jobPartKey";

interface EditableFields {
  quantityPulled?: number; // Legacy - will be sum of shop + vendor
  quantityPulledFromShop?: number;
  quantityPulledFromVendor?: number;
  quantityPulledFromPreorder?: number;
  pulledBy?: string;
  pulledDate?: string;
  ordered?: string;
  receivedFromOrder?: string;
  type?: string;
  partNumber?: string;
  description?: string;
  uom?: string;
  quantityNeeded?: number;
  quantityFab?: number;
  quantityOrdered?: number;
  lineOrder?: number | null;
}

interface StaticTableRowProps {
  rowId: number;
  rowClassName: string;
  children: ReactNode;
  onDragOver?: (e: DragEvent<HTMLTableRowElement>) => void;
  onDrop?: (e: DragEvent<HTMLTableRowElement>) => void;
}

function StaticTableRow({
  rowId,
  rowClassName,
  children,
  onDragOver,
  onDrop,
}: StaticTableRowProps) {
  return (
    <tr
      data-job-row-index={rowId}
      className={rowClassName}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {children}
    </tr>
  );
}

const JOB_ROW_DND_MIME = "application/x-tftp-job-row-index";

interface JobItemsTableProps {
  lineItems: JobLineItem[];
  showUnpulledOnly: boolean;
  onSave: (updates: Map<number, EditableFields>) => Promise<void>;
  isSaving: boolean;
  onAddLineItem?: () => void;
  onEditJob?: () => void;
  onDeleteJob?: () => void;
  onDeleteLineItem?: (partNumber: string, listNumber: string) => Promise<void>;
  emptyStateActions?: ReactNode;
  /** Full job/list lines for bulk Order All (ignores overview tab filters). */
  bulkActionLineItems?: JobLineItem[];
  onToolbarData?: (data: {
    listedBy: string;
    onPullAll: () => void;
    onOrderAll: () => void;
    orderAllEligibleCount: number;
  }) => void;
  onUnsavedChangesChange?: (hasChanges: boolean) => void;
  registerSaveHandler?: (
    handler: ((opts?: { silent?: boolean }) => Promise<boolean>) | null,
  ) => void;
  canEditOverride?: boolean;
  canPullFromShopOverride?: boolean;
  canOrderItemsOverride?: boolean;
  canEditLineItemsOverride?: boolean;
  canDeleteLineItemsOverride?: boolean;
  canAddLineItemsOverride?: boolean;
  /** Keys in format jobNumber::partNumber for items that appear in any Purchase Order */
  itemsInPurchaseOrders?: Set<string>;
  /** Optional scroll container ref so we can preserve in-tab scroll when ordering */
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  /** Active filter (e.g. "remaining") for empty-state messaging when no items match */
  activeFilter?: LineFilter;
  discardChangesSignal?: number;
  listNumber?: string | null;
  /** Normalized part key → qty available in the job received pre-order pool. */
  jobPreorderPoolAvailable?: ReadonlyMap<string, number>;
  /** Normalized part key → qty still on order (not received). Informational only. */
  jobPreorderOpenByPart?: ReadonlyMap<string, number>;
}

export default function JobItemsTable({
  lineItems,
  showUnpulledOnly,
  onSave,
  isSaving,
  onAddLineItem,
  onEditJob,
  onDeleteJob,
  onDeleteLineItem,
  emptyStateActions,
  bulkActionLineItems,
  onToolbarData,
  onUnsavedChangesChange,
  registerSaveHandler,
  canEditOverride,
  canPullFromShopOverride,
  canOrderItemsOverride,
  canEditLineItemsOverride,
  canDeleteLineItemsOverride,
  canAddLineItemsOverride,
  itemsInPurchaseOrders,
  scrollContainerRef,
  activeFilter,
  discardChangesSignal = 0,
  listNumber,
  jobPreorderPoolAvailable,
  jobPreorderOpenByPart,
}: JobItemsTableProps) {
  const jobPreorderFeaturesEnabled = isJobPreorderEnabled();

  // Auth
  const { canEdit: canEditSystem, user, isAdmin } = useAuth();

  // All of canEdit/canPullFromShop/canOrderItems/canEditLineItems/
  // canAddLineItems/canDeleteParts are always passed in as explicit
  // permission-derived overrides by the job page (which already accounts
  // for per-job permission overrides); the isAdmin/canEditSystem fallback
  // below only matters for a caller that doesn't supply them.
  const canEdit = typeof canEditOverride === "boolean" ? canEditOverride : isAdmin || canEditSystem;
  const defaultLineEditAccess = isAdmin || canEditSystem;
  const canPullFromShop =
    typeof canPullFromShopOverride === "boolean"
      ? canPullFromShopOverride
      : defaultLineEditAccess;
  const canOrderItems =
    typeof canOrderItemsOverride === "boolean"
      ? canOrderItemsOverride
      : defaultLineEditAccess;
  const canEditLineItems =
    typeof canEditLineItemsOverride === "boolean"
      ? canEditLineItemsOverride
      : defaultLineEditAccess;
  const canAddLineItems =
    typeof canAddLineItemsOverride === "boolean"
      ? canAddLineItemsOverride
      : defaultLineEditAccess;

  // Check delete permissions: Admin only by default (job.puller.delete_line override applies otherwise)
  const canDeleteParts =
    typeof canDeleteLineItemsOverride === "boolean" ? canDeleteLineItemsOverride : isAdmin;

  // Local state for edits
  const [edits, setEdits] = useState<Map<number, EditableFields>>(new Map());
  const [pullerName, setPullerName] = useState(user?.name || "Current User");
  const [vendorData, setVendorData] = useState<Map<string, string>>(new Map());
  const [allVendors, setAllVendors] = useState<string[]>([]);
  const [showVendorWarning, setShowVendorWarning] = useState(false);
  const [vendorMismatches, setVendorMismatches] = useState<
    Array<{
      partNumber: string;
      description: string | null;
      databaseVendor: string;
      userVendor: string;
    }>
  >([]);
  const [customVendors, setCustomVendors] = useState<Map<number, string>>(
    new Map(),
  ); // Store custom vendor values when "Other" is selected
  const [manualVendorSelections, setManualVendorSelections] = useState<
    Set<number>
  >(new Set()); // Track items where user explicitly chose any vendor (named or "Other")
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [orderModalItem, setOrderModalItem] = useState<JobLineItem | null>(
    null,
  );
  const [orderQuantity, setOrderQuantity] = useState<number>(0);
  const [showOrderAllModal, setShowOrderAllModal] = useState(false);
  const [orderAllSummary, setOrderAllSummary] = useState<{
    eligibleCount: number;
    totalQty: number;
    skippedCount: number;
  } | null>(null);

  // Delete line item state
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [partToDelete, setPartToDelete] = useState<{ partNumber: string; listNumber: string; description: string | null } | null>(null);
  const [deletingPartNumber, setDeletingPartNumber] = useState<string | null>(null);

  // Cancel order modal state
  const [showCancelOrderModal, setShowCancelOrderModal] = useState(false);
  const [itemToCancelOrder, setItemToCancelOrder] = useState<JobLineItem | null>(null);
  const [cancellingOrderRowIndex, setCancellingOrderRowIndex] = useState<number | null>(null);

  // Inventory quantity state
  const [inventoryQuantities, setInventoryQuantities] = useState<
    Map<string, number>
  >(new Map());
  const [allocationNotice, setAllocationNotice] = useState<string | null>(
    null,
  );
  const allocationNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const desktopScrollRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const getOverviewScrollContainer = (): HTMLElement | null =>
    scrollContainerRef?.current ?? desktopScrollRef.current ?? null;
  const syncHeaderHorizontalScroll = () => {
    const header = headerScrollRef.current;
    const body = desktopScrollRef.current;
    if (header && body) {
      header.scrollLeft = body.scrollLeft;
      syncHeaderScrollbarGutter();
    }
  };

  const syncHeaderScrollbarGutter = () => {
    const header = headerScrollRef.current;
    const body = desktopScrollRef.current;
    if (!header || !body) return;
    const gutter = body.offsetWidth - body.clientWidth;
    header.style.paddingRight = gutter > 0 ? `${gutter}px` : "";
  };

  // On mount, if a last-ordered row was stored (e.g. before a refresh),
  // scroll that row back into view inside the puller scroll container.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const keyBase = `${window.location.pathname}${window.location.search || ""}`;
    const rowKey = `jobLastOrderedRow:${keyBase}`;
    const storedRow = window.sessionStorage.getItem(rowKey);
    if (!storedRow) return;
    const rowIndex = parseInt(storedRow, 10);
    window.sessionStorage.removeItem(rowKey);
    if (Number.isNaN(rowIndex)) return;

    requestAnimationFrame(() => {
      const container = getOverviewScrollContainer();
      const rowEl = document.querySelector<HTMLElement>(
        `[data-job-row-index="${rowIndex}"]`,
      );
      if (!rowEl) return;
      const offset = rowEl.offsetTop - 150;
      const targetTop = offset > 0 ? offset : 0;
      if (container) {
        container.scrollTo({ top: targetTop });
      } else {
        window.scrollTo({ top: targetTop });
      }
    });
  }, [scrollContainerRef]);

  /** Puller/Overview scroll container scrollTop, or window scrollY if no container. */
  const captureOverviewScrollTop = (): number => {
    const container = getOverviewScrollContainer();
    if (container) return container.scrollTop;
    if (typeof window !== "undefined") return window.scrollY || 0;
    return 0;
  };

  /** Restore after parent `setLineItems` re-renders (double rAF so layout has settled). */
  const restoreOverviewScrollAfterPaint = (scrollTop: number) => {
    const apply = () => {
      const container = getOverviewScrollContainer();
      if (container) {
        container.scrollTo({ top: scrollTop });
      } else if (typeof window !== "undefined") {
        window.scrollTo({ top: scrollTop });
      }
    };
    requestAnimationFrame(() => {
      apply();
      requestAnimationFrame(apply);
    });
  };

  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryErrors, setInventoryErrors] = useState<Map<string, string>>(
    new Map(),
  );

  const markAllPulledRef = useRef<(() => void) | null>(null);
  const orderAllRef = useRef<(() => void) | null>(null);
  const orderAllPendingEditsRef = useRef<Map<number, EditableFields> | null>(
    null,
  );
  const orderAllRowIndexesRef = useRef<number[]>([]);
  const listedByDisplay = useMemo(() => {
    const listedByName = lineItems.find(
      (item) => typeof item.listedByName === "string" && item.listedByName.trim() !== "",
    )?.listedByName;
    return listedByName?.trim() || "Not set";
  }, [lineItems]);

  // Get today's date in YYYY-MM-DD format
  const getTodayDate = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const orderedLineItems = lineItems;

  const lineItemsByRowIndex = useMemo(() => {
    const map = new Map<number, JobLineItem>();
    for (const item of lineItems) {
      map.set(item.rowIndex, item);
    }
    for (const item of bulkActionLineItems ?? []) {
      if (!map.has(item.rowIndex)) {
        map.set(item.rowIndex, item);
      }
    }
    return map;
  }, [lineItems, bulkActionLineItems]);

  const resolveLineItem = (rowIndex: number): JobLineItem | undefined =>
    lineItemsByRowIndex.get(rowIndex);

  const reorderEligibleList = useMemo(() => {
    if (lineItems.length === 0) return true;
    const firstList = lineItems[0]?.listNumber ?? "1";
    return lineItems.every(
      (item) => (item.listNumber ?? "1") === firstList,
    );
  }, [lineItems]);

  const canReorderRows =
    canEditLineItems &&
    (!activeFilter || activeFilter === "all") &&
    !showUnpulledOnly &&
    reorderEligibleList &&
    lineItems.length > 1;

  const [dragOrder, setDragOrder] = useState<number[] | null>(null);
  const [draggingRowIndex, setDraggingRowIndex] = useState<number | null>(
    null,
  );

  useEffect(() => {
    setDragOrder(lineItems.map((item) => item.rowIndex));
  }, [lineItems, discardChangesSignal]);

  // Hoisted above filteredItems (below) because that useMemo's factory runs
  // synchronously during render and needs getRemaining's full call chain
  // already initialized — defining them further down the component body
  // would throw "Cannot access before initialization".
  const getCurrentFieldValue = (
    item: JobLineItem,
    field: keyof JobLineItem,
  ): any => {
    const edit = edits.get(item.rowIndex);
    if (edit && (edit as any)[field] !== undefined) {
      return (edit as any)[field];
    }
    return item[field];
  };

  const getVendorReceivedFromMerge = (
    item: JobLineItem,
    merge: Partial<EditableFields> | undefined,
  ): number => {
    const m = merge || {};
    if (m.quantityPulledFromVendor !== undefined) {
      return getVendorReceivedForRemaining(m.quantityPulledFromVendor);
    }
    return getVendorReceivedForRemaining(item.quantityReceivedFromOrder);
  };

  /** Vendor qty counted in Remaining column: received only (not full open PO qty). */
  const getVendorReceivedForSumFromMerge = (
    item: JobLineItem,
    merge: Partial<EditableFields> | undefined,
  ): number => getVendorReceivedFromMerge(item, merge);

  // Get pulled from shop
  const getPulledFromShop = (item: JobLineItem) => {
    const edit = edits.get(item.rowIndex);
    if (edit && edit.quantityPulledFromShop !== undefined) {
      return edit.quantityPulledFromShop;
    }
    // No edit: quantityPulled in the database IS the shop-pulled quantity
    // It is independent of quantityReceivedFromOrder (vendor pulls)
    return item.quantityPulled || 0;
  };

  const getPulledFromPreorder = (item: JobLineItem) => {
    if (!jobPreorderFeaturesEnabled) return 0;
    const edit = edits.get(item.rowIndex);
    if (edit && edit.quantityPulledFromPreorder !== undefined) {
      return Math.max(0, edit.quantityPulledFromPreorder);
    }
    return Math.max(
      0,
      item.quantityPulledFromPreorder ?? item.quantityPreordered ?? 0,
    );
  };

  const getVendorReceivedForSum = (item: JobLineItem): number =>
    getVendorReceivedForSumFromMerge(item, edits.get(item.rowIndex));

  // remaining = needed - fab - shop - preOrder - vendorReceived (received only, not open PO qty)
  const getRemaining = (item: JobLineItem) => {
    const needed = toNonNegativeInt(
      getCurrentFieldValue(item, "quantityNeeded"),
    );
    const fab = clampFab(getCurrentFieldValue(item, "quantityFab"), needed);
    const shop = toNonNegativeInt(getPulledFromShop(item));
    const v = toNonNegativeInt(getVendorReceivedForSum(item));
    const jobPo = toNonNegativeInt(getPulledFromPreorder(item));
    return getRemainingQty({
      needed,
      fab,
      shop,
      preorder: jobPo,
      vendor: v,
    });
  };

  // Filter items based on "Show unfulfilled paths" toggle
  const filteredItems = useMemo(() => {
    if (!showUnpulledOnly) {
      return orderedLineItems;
    }

    // Strict definition: a row is "attended to" only when Remaining = 0.
    // Use the same getRemaining as the table column so the filter stays in sync.
    return orderedLineItems.filter((item) => getRemaining(item) > 0);
  }, [orderedLineItems, showUnpulledOnly, edits, jobPreorderPoolAvailable]);

  const applyRowReorderByRowIndex = (
    sourceRowIndex: number,
    targetRowIndex: number,
  ) => {
    if (!canReorderRows || !dragOrder) return;
    const from = dragOrder.indexOf(sourceRowIndex);
    const to = dragOrder.indexOf(targetRowIndex);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...dragOrder];
    const [removed] = next.splice(from, 1);
    next.splice(to, 0, removed);
    setDragOrder(next);
    setEdits((prev) => {
      const newEdits = new Map(prev);
      next.forEach((rowIndex, i) => {
        const existing = newEdits.get(rowIndex);
        newEdits.set(rowIndex, { ...(existing ?? {}), lineOrder: i + 1 });
      });
      return newEdits;
    });
  };

  // Use all filtered items (no pagination); optional manual line order
  const displayedItems = useMemo(() => {
    if (!canReorderRows || !dragOrder?.length) {
      return filteredItems;
    }
    const byRow = new Map(
      filteredItems.map((item) => [item.rowIndex, item]),
    );
    const ordered: JobLineItem[] = [];
    for (const rowIndex of dragOrder) {
      const item = byRow.get(rowIndex);
      if (item) ordered.push(item);
    }
    for (const item of filteredItems) {
      if (!ordered.includes(item)) ordered.push(item);
    }
    return ordered;
  }, [canReorderRows, dragOrder, filteredItems]);

  useEffect(() => {
    const body = desktopScrollRef.current;
    if (!body) return;
    syncHeaderScrollbarGutter();
    const ro = new ResizeObserver(() => syncHeaderScrollbarGutter());
    ro.observe(body);
    return () => ro.disconnect();
  }, [displayedItems.length, canReorderRows]);

  useEffect(() => {
    if (allocationNoticeTimerRef.current) {
      clearTimeout(allocationNoticeTimerRef.current);
      allocationNoticeTimerRef.current = null;
    }
    if (!allocationNotice) return;
    allocationNoticeTimerRef.current = setTimeout(() => {
      setAllocationNotice(null);
      allocationNoticeTimerRef.current = null;
    }, 5000);
    return () => {
      if (allocationNoticeTimerRef.current) {
        clearTimeout(allocationNoticeTimerRef.current);
        allocationNoticeTimerRef.current = null;
      }
    };
  }, [allocationNotice]);

  // Get current value for an item (from edits or original) - total pulled
  const getCurrentValue = (item: JobLineItem) => {
    const edit = edits.get(item.rowIndex);
    if (edit) {
      const shop = edit.quantityPulledFromShop ?? 0;
      const vendor = edit.quantityPulledFromVendor ?? 0;
      // Always use shop + vendor split if edit has these fields
      if (
        edit.quantityPulledFromShop !== undefined ||
        edit.quantityPulledFromVendor !== undefined
      ) {
        return shop + vendor;
      }
      // Fallback to legacy quantityPulled from edit
      return edit.quantityPulled ?? item.quantityPulled ?? 0;
    }
    // No edit: use shop + vendor from database/calculated values
    // This ensures vendor pulls (quantityReceivedFromOrder) are included in remaining calculation
    return getPulledFromShop(item) + getPulledFromVendor(item);
  };

  // Get original pulled from shop (before any edits) - used for validation
  const getOriginalPulledFromShop = (item: JobLineItem) => {
    // Always use the original value from the database, not from edits
    // Since database doesn't have shop/vendor split yet, we use total pulled
    return item.quantityPulled || 0;
  };

  // Get pulled from vendor
  const getPulledFromVendor = (item: JobLineItem) => {
    const edit = edits.get(item.rowIndex);
    if (edit && edit.quantityPulledFromVendor !== undefined) {
      return edit.quantityPulledFromVendor;
    }
    // If no edit, use quantityReceivedFromOrder (what was received from vendor orders)
    // This represents items that were marked as received in the pending to receive tab
    return item.quantityReceivedFromOrder || 0;
  };

  const getOriginalPulledFromPreorder = (item: JobLineItem) =>
    Math.max(0, item.quantityPulledFromPreorder ?? item.quantityPreordered ?? 0);

  const getMaxPreorderPullForItem = (item: JobLineItem): number => {
    const partKey = jobPreorderPartKey(item.partNumber);
    const poolGlobal = Math.max(0, jobPreorderPoolAvailable?.get(partKey) ?? 0);
    const currentPull = getPulledFromPreorder(item);
    const originalPull = getOriginalPulledFromPreorder(item);
    const poolForThisLine = poolGlobal + originalPull;
    const needed = toNonNegativeInt(
      getCurrentFieldValue(item, "quantityNeeded") ?? item.quantityNeeded,
    );
    const fab = clampFab(
      getCurrentFieldValue(item, "quantityFab") ?? item.quantityFab,
      needed,
    );
    const shop = toNonNegativeInt(getPulledFromShop(item));
    const vendor = toNonNegativeInt(getVendorReceivedForSum(item));
    const lineRemaining = Math.max(0, needed - fab - shop - vendor - currentPull);
    return Math.min(poolForThisLine, lineRemaining + currentPull);
  };

  const getPreorderOpenForItem = (item: JobLineItem): number => {
    const partKey = jobPreorderPartKey(item.partNumber);
    return Math.max(0, jobPreorderOpenByPart?.get(partKey) ?? 0);
  };

  /** Job-wide received pre-order stock not yet pulled onto any line. */
  const getPreorderPoolAvailableForPart = (item: JobLineItem): number => {
    if (!jobPreorderFeaturesEnabled) return 0;
    const partKey = jobPreorderPartKey(item.partNumber);
    return Math.max(0, jobPreorderPoolAvailable?.get(partKey) ?? 0);
  };

  const renderPreorderPullControl = (
    item: JobLineItem,
    variant: "mobile" | "desktop",
  ) => {
    const pulled = getPulledFromPreorder(item);
    const maxPull = getMaxPreorderPullForItem(item);
    const poolGlobal = Math.max(
      0,
      jobPreorderPoolAvailable?.get(jobPreorderPartKey(item.partNumber)) ?? 0,
    );
    const originalPull = getOriginalPulledFromPreorder(item);
    const available = poolGlobal + originalPull;
    const openQty = getPreorderOpenForItem(item);
    const isDesktop = variant === "desktop";
    const inputClass = isDesktop
      ? "overview-qty-input w-full min-w-0 max-w-[4.75rem] mx-auto px-1.5 py-0.5 lg:px-2 lg:py-1 bg-white dark:bg-slate-700/50 border border-fuchsia-500/40 text-slate-900 dark:text-white rounded text-[10px] xl:text-sm text-center font-semibold tabular-nums leading-none focus:ring-1 focus:ring-fuchsia-500 focus:border-fuchsia-500 disabled:bg-slate-800/50"
      : "w-full px-3 py-2.5 bg-white dark:bg-slate-700/50 border border-fuchsia-500/40 text-slate-900 dark:text-white rounded-lg text-base font-medium focus:ring-2 focus:ring-fuchsia-500 focus:border-fuchsia-500 disabled:bg-gray-100 dark:disabled:bg-slate-800/50";

    return (
      <>
        <input
          type="number"
          min={0}
          max={maxPull}
          value={pulled}
          onChange={(e) => {
            const raw = Math.max(0, Math.floor(Number(e.target.value) || 0));
            const capped = Math.min(raw, maxPull);
            updateField(item.rowIndex, "quantityPulledFromPreorder", capped);
          }}
          disabled={!canEditLineItems || isSaving || maxPull <= 0}
          title={
            !canEditLineItems
              ? "Edit line items permission required"
              : maxPull <= 0
              ? "No received pre-order stock available for this part"
              : `Pull from job pre-order pool (max ${maxPull})`
          }
          className={inputClass}
        />
        <p
          className={`${isDesktop ? "mt-0.5" : "mt-1"} ${
            available > 0
              ? isDesktop
                ? "text-[9px] xl:text-xs font-bold text-fuchsia-700 dark:text-fuchsia-200"
                : "text-xs font-bold text-fuchsia-700 dark:text-fuchsia-200"
              : isDesktop
                ? "text-[8px] xl:text-[10px] text-fuchsia-700/80 dark:text-fuchsia-300/80"
                : "text-xs text-fuchsia-700/80 dark:text-fuchsia-300/80"
          }`}
        >
          {available > 0
            ? `Pool: ${available} available`
            : `Pool: ${available}`}
          {openQty > 0 ? ` · On order: ${openQty}` : ""}
        </p>
      </>
    );
  };

  // Get original pulled from vendor (before any edits) - used for validation
  const getOriginalPulledFromVendor = (item: JobLineItem) => {
    // Always use the original value from the database (quantityReceivedFromOrder)
    return item.quantityReceivedFromOrder || 0;
  };

  // Get maximum allowed vendor pull (what was actually received)
  const getMaxVendorPull = (item: JobLineItem): number => {
    // Return what was actually received from vendor (cumulative)
    // This allows partial receives to work correctly
    return item.quantityReceivedFromOrder || 0;
  };

  // Get available inventory for a part (accounting for already-pulled quantities from OTHER items)
  // This excludes the current item's pulls, so you can pull the full remaining inventory
  const getAvailableInventory = (item: JobLineItem): number => {
    const partNumber =
      edits.has(item.rowIndex) &&
      edits.get(item.rowIndex)!.partNumber !== undefined
        ? edits.get(item.rowIndex)!.partNumber
        : item.partNumber;

    if (!partNumber) {
      return 0;
    }

    // Get inventory quantity from database
    const inventoryQuantity = inventoryQuantities.get(partNumber);
    if (inventoryQuantity === undefined || inventoryQuantity === null) {
      // Part not found in inventory - treat as 0 available
      return 0;
    }

    // Calculate total shop pulls for this part number across OTHER line items (excluding current item)
    // This accounts for multiple line items with the same part number
    // We exclude the current item so the user can pull the full remaining inventory
    let otherItemsShopPulled = 0;

    lineItems.forEach((li) => {
      // Skip the current item - don't count its pulls in the available calculation
      if (li.rowIndex === item.rowIndex) {
        return;
      }

      const liPartNumber =
        edits.has(li.rowIndex) &&
        edits.get(li.rowIndex)!.partNumber !== undefined
          ? edits.get(li.rowIndex)!.partNumber
          : li.partNumber;

      // Only count if same part number
      if (liPartNumber === partNumber) {
        const liEdit = edits.get(li.rowIndex);
        if (liEdit && liEdit.quantityPulledFromShop !== undefined) {
          // Use edited value
          otherItemsShopPulled += liEdit.quantityPulledFromShop || 0;
        } else {
          otherItemsShopPulled += li.quantityPulled || 0;
        }
      }
    });

    // Calculate available: inventory - other items' shop pulls (not current item)
    // This represents how much inventory is available for the current item to pull
    const available = Math.max(0, inventoryQuantity - otherItemsShopPulled);

    return available;
  };

  const canEditField = (field: keyof EditableFields): boolean => {
    if (
      field === "quantityPulled" ||
      field === "quantityPulledFromShop" ||
      field === "quantityPulledFromVendor" ||
      field === "pulledBy" ||
      field === "pulledDate"
    ) {
      return canPullFromShop;
    }
    if (field === "ordered" || field === "quantityOrdered" || field === "receivedFromOrder") {
      return canOrderItems;
    }
    return canEditLineItems;
  };

  const isOrderedFromMerge = (
    item: JobLineItem,
    merge: Partial<EditableFields> | undefined,
  ): boolean => {
    const m = merge || {};
    if (m.ordered !== undefined) {
      return m.ordered === "Yes";
    }
    return item.ordered?.toLowerCase() === "yes";
  };

  const getVendorOrderedQtyFromMerge = (
    item: JobLineItem,
    merge: Partial<EditableFields> | undefined,
  ): number => {
    const m = merge || {};
    if (m.quantityOrdered !== undefined && m.quantityOrdered !== null) {
      return Math.max(0, Number(m.quantityOrdered));
    }
    const q = item.quantityOrdered;
    return q != null && Number.isFinite(Number(q))
      ? Math.max(0, Number(q))
      : 0;
  };

  /** Clamp FAB / shop so FAB + shop + job preorder + vendor received ≤ needed. */
  const clampAllocationsToSumRow = (
    item: JobLineItem,
    merged: EditableFields,
  ): EditableFields => {
    const needed = toNonNegativeInt(
      merged.quantityNeeded ?? item.quantityNeeded,
    );
    const v = toNonNegativeInt(getVendorReceivedForSumFromMerge(item, merged));
    let fab = clampFab(merged.quantityFab ?? item.quantityFab, needed);
    let shop =
      merged.quantityPulledFromShop !== undefined
        ? toNonNegativeInt(merged.quantityPulledFromShop)
        : toNonNegativeInt(item.quantityPulled);
    let pre =
      merged.quantityPulledFromPreorder !== undefined
        ? toNonNegativeInt(merged.quantityPulledFromPreorder)
        : toNonNegativeInt(getPulledFromPreorder(item));
    pre = Math.min(pre, getMaxPreorderPullForItem({ ...item, ...merged } as JobLineItem));

    fab = Math.min(fab, Math.max(0, needed - shop - pre - v));
    shop = Math.min(shop, Math.max(0, needed - fab - pre - v));
    pre = Math.min(pre, Math.max(0, needed - fab - shop - v));
    fab = Math.min(fab, Math.max(0, needed - shop - pre - v));

    const vendorPull = getVendorReceivedFromMerge(item, merged);
    return {
      ...merged,
      quantityNeeded: needed,
      quantityFab: fab,
      quantityPulledFromShop: shop,
      quantityPulledFromPreorder: pre,
      quantityPulled: shop + vendorPull,
    };
  };

  // Update a single field for an item
  const updateField = (
    rowIndex: number,
    field: keyof EditableFields,
    value: any,
  ) => {
    if (!canEditField(field) || isSaving) return;
    const newEdits = new Map(edits);
    const existing = edits.get(rowIndex) || {};
    const item = lineItems.find((line) => line.rowIndex === rowIndex);
    const currentNeeded = toNonNegativeInt(
      existing.quantityNeeded ?? item?.quantityNeeded,
    );
    const currentFab = clampFab(
      existing.quantityFab ?? item?.quantityFab,
      currentNeeded,
    );

    let nextValue = value;
    let nextFab = currentFab;
    let nextNeeded = currentNeeded;

    if (field === "quantityNeeded") {
      if (!item) return;
      nextNeeded = toNonNegativeInt(value);
      nextValue = nextNeeded;
      nextFab = clampFab(
        existing.quantityFab ?? item.quantityFab,
        nextNeeded,
      );
      const merged = clampAllocationsToSumRow(item, {
        ...existing,
        quantityNeeded: nextValue,
        quantityFab: nextFab,
      });
      newEdits.set(rowIndex, merged);
      setEdits(newEdits);
      return;
    }

    if (field === "quantityFab") {
      if (!item) return;
      const requestedFab = toNonNegativeInt(value);
      nextFab = clampFab(requestedFab, currentNeeded);
      nextFab = Math.min(nextFab, getMaxFabAllowedForItem(item));
      const merged = clampAllocationsToSumRow(item, {
        ...existing,
        quantityFab: nextFab,
      });
      notifyIfFullyCoveredIncreaseBlocked(item, "FAB", requestedFab, merged);
      newEdits.set(rowIndex, merged);
      setEdits(newEdits);
      return;
    }

    newEdits.set(rowIndex, {
      ...existing,
      [field]: nextValue,
    });
    setEdits(newEdits);

    // When part number changes, clear manual vendor selection so auto-update
    // can look up the correct vendor for the new part number
    if (field === "partNumber") {
      const newManualVendorSelections = new Set(manualVendorSelections);
      newManualVendorSelections.delete(rowIndex);
      setManualVendorSelections(newManualVendorSelections);
    }
  };

  // Update a single item (legacy function for quantity) - now updates shop + vendor
  const updateItem = (
    rowIndex: number,
    totalQuantity: number,
    ordered?: string,
  ) => {
    if (!canPullFromShop || isSaving) return;
    const newEdits = new Map(edits);
    const existing = edits.get(rowIndex);
    // When using legacy updateItem, put everything in shop for now
    newEdits.set(rowIndex, {
      ...existing,
      quantityPulledFromShop: totalQuantity,
      quantityPulledFromVendor: 0,
      quantityPulled: totalQuantity, // Keep for backward compatibility
      pulledBy: pullerName,
      pulledDate: getTodayDate(),
      ordered: ordered !== undefined ? ordered : existing?.ordered,
    });
    setEdits(newEdits);
  };

  // Update vendor from dropdown
  const updateVendorFromDropdown = (
    rowIndex: number,
    selectedValue: string,
  ) => {
    if (!canEditLineItems || isSaving) return;
    const newEdits = new Map(edits);
    const existing = edits.get(rowIndex);
    const item = lineItems.find((i) => i.rowIndex === rowIndex)!;
    const newManualVendorSelections = new Set(manualVendorSelections);

    if (selectedValue === "Other") {
      // If "Other" is selected, mark it as manually selected immediately
      newManualVendorSelections.add(rowIndex);
      setManualVendorSelections(newManualVendorSelections);

      // Keep the custom vendor value if it exists (normalize), otherwise use empty string
      const customValue = normalizeVendorKey(customVendors.get(rowIndex) || "");
      newEdits.set(rowIndex, {
        ...existing,
        ordered: existing?.ordered,
        type: customValue,
      });
      setEdits(newEdits);
    } else {
      // A named vendor was selected - mark as manually set so auto-update won't override it
      newManualVendorSelections.add(rowIndex);
      setManualVendorSelections(newManualVendorSelections);

      newEdits.set(rowIndex, {
        ...existing,
        ordered: existing?.ordered,
        type: normalizeVendorKey(selectedValue),
      });
      setEdits(newEdits);

      // Clear custom vendor if switching away from "Other"
      if (customVendors.has(rowIndex)) {
        const newCustomVendors = new Map(customVendors);
        newCustomVendors.delete(rowIndex);
        setCustomVendors(newCustomVendors);
      }
    }
  };

  // Update custom vendor value (when "Other" is selected and user types)
  const updateCustomVendor = (rowIndex: number, customValue: string) => {
    if (!canEditLineItems || isSaving) return;
    const newCustomVendors = new Map(customVendors);
    if (customValue) {
      newCustomVendors.set(rowIndex, customValue);
    } else {
      newCustomVendors.delete(rowIndex);
    }
    setCustomVendors(newCustomVendors);

    // Also update the edit with the custom vendor (normalize to lowercase for storage)
    const newEdits = new Map(edits);
    const existing = edits.get(rowIndex);
    const item = lineItems.find((i) => i.rowIndex === rowIndex)!;
    newEdits.set(rowIndex, {
      ...existing,
      ordered: existing?.ordered,
      type: normalizeVendorKey(customValue),
    });
    setEdits(newEdits);
  };

  // Auto-update vendor when part number or vendorData changes
  useEffect(() => {
    if (vendorData.size === 0) return; // Don't update if no vendor data loaded yet

    const newEdits = new Map(edits);
    let hasChanges = false;

    lineItems.forEach((item) => {
      // Skip auto-update if user has explicitly selected any vendor (named or "Other") for this item
      if (manualVendorSelections.has(item.rowIndex)) {
        return;
      }

      const edit = edits.get(item.rowIndex);
      const currentPartNumber = edit?.partNumber ?? item.partNumber;
      const existingVendor = edit?.type;

      // Only auto-update if there is no valid vendor already set.
      // "Valid vendor" means item.type (the saved value) is a recognized vendor in allVendors.
      // If a valid vendor is already saved, respect it — don't create unsaved changes on load.
      // Auto-update is only useful when the item has no vendor yet (null/empty) or has a
      // non-vendor type value (e.g. "Shop", "Fab'd") that needs a real vendor filled in.
      const savedTypeIsValidVendor =
        item.type &&
        item.type.trim() !== "" &&
        allVendors.includes(normalizeVendorKey(item.type));

      if (
        currentPartNumber &&
        !existingVendor &&
        !savedTypeIsValidVendor
      ) {
        // Normalize part number for lookup
        const normalizedPN = currentPartNumber
          .replace(/[\s\t\r\n]+/g, "")
          .toUpperCase()
          .trim();
        const vendor =
          vendorData.get(normalizedPN) ||
          vendorData.get(currentPartNumber.trim()) ||
          vendorData.get(currentPartNumber);

        if (vendor && allVendors.includes(normalizeVendorKey(vendor))) {
          const existingEdit = edits.get(item.rowIndex) || {};
          newEdits.set(item.rowIndex, {
            ...existingEdit,
            type: vendor,
          });
          hasChanges = true;
        }
      }
    });

    if (hasChanges) {
      setEdits(newEdits);
    }
  }, [vendorData, lineItems, allVendors, manualVendorSelections]); // Run when vendorData, lineItems, allVendors, or manualVendorSelections change

  // Set item to "All" (quantity needed) - vendor receipts first, then shop, capped to inventory
  const setToAll = (item: JobLineItem) => {
    if (isShopPullBlocked(item) || isLineCovered(item)) return;
    const remaining = getRemaining(item);
    const available = getAvailableInventory(item);
    const maxVendorPull = getMaxVendorPull(item);

    let vendorPull = 0;
    let shopPull = 0;
    let left = remaining;

    if (maxVendorPull > 0 && left > 0) {
      vendorPull = Math.min(left, maxVendorPull);
      left -= vendorPull;
    }
    if (left > 0 && available > 0) {
      shopPull = Math.min(left, available);
    }

    const totalPulled = vendorPull + shopPull;

    // Show warnings if quantities were capped
    if (totalPulled < remaining) {
      const partNumber =
        edits.has(item.rowIndex) &&
        edits.get(item.rowIndex)!.partNumber !== undefined
          ? edits.get(item.rowIndex)!.partNumber
          : item.partNumber;

      if (
        vendorPull > 0 &&
        vendorPull < maxVendorPull &&
        remaining > maxVendorPull
      ) {
        console.warn(
          `⚠️ Capped vendor pull to received amount: ${vendorPull} (max received: ${maxVendorPull}) for part ${partNumber}`,
        );
      }
      if (shopPull < remaining - vendorPull && available > 0) {
        console.warn(
          `⚠️ Capped shop pull to available inventory: ${shopPull} (requested: ${remaining - vendorPull}, available: ${available}) for part ${partNumber}`,
        );
      } else if (available === 0 && remaining - vendorPull > 0) {
        console.warn(`⚠️ No inventory available for part ${partNumber}`);
      }
      // TODO: Show toast notification to user
    }

    const newEdits = new Map(edits);
    const existing = edits.get(item.rowIndex) || {};
    newEdits.set(
      item.rowIndex,
      clampAllocationsToSumRow(item, {
        ...existing,
        quantityPulledFromShop: shopPull,
        quantityPulledFromVendor: vendorPull,
        quantityPulled: totalPulled, // Keep for backward compatibility
        pulledBy: pullerName,
        pulledDate: getTodayDate(),
      }),
    );
    setEdits(newEdits);
  };

  // Handle delete line item
  const handleDeletePart = async () => {
    if (!onDeleteLineItem || !partToDelete) return;
    
    try {
      setDeletingPartNumber(partToDelete.partNumber);
      await onDeleteLineItem(partToDelete.partNumber, partToDelete.listNumber);
      setShowDeleteConfirmModal(false);
      setPartToDelete(null);
    } catch (error) {
      console.error("Error deleting part:", error);
      // Error handling is done in parent
    } finally {
      setDeletingPartNumber(null);
    }
  };

  const openDeleteConfirmModal = (item: JobLineItem) => {
    setPartToDelete({
      partNumber: item.partNumber || "",
      listNumber: item.listNumber || "1",
      description: item.description,
    });
    setShowDeleteConfirmModal(true);
  };

  // Mark all visible items as pulled - handles both shop and vendor pulls
  const markAllPulled = () => {
    if (!canPullFromShop || isSaving) return;
    const newEdits = new Map(edits);
    let cappedCount = 0;
    const cappedItems: Array<{
      partNumber: string | null;
      requested: number;
      available: number;
      capped: number;
    }> = [];

    filteredItems.forEach((item) => {
      if (isShopPullBlocked(item) || isLineCovered(item)) return;
      const remaining = getRemaining(item);
      const available = getAvailableInventory(item);
      const maxVendorPull = getMaxVendorPull(item);

      let vendorPull = 0;
      let shopPull = 0;
      let left = remaining;

      if (maxVendorPull > 0 && left > 0) {
        vendorPull = Math.min(left, maxVendorPull);
        left -= vendorPull;
      }
      if (left > 0 && available > 0) {
        shopPull = Math.min(left, available);
      }

      const totalPulled = vendorPull + shopPull;

      // Track if this item was capped
      if (totalPulled < remaining && remaining > 0) {
        cappedCount++;
        const partNumber =
          edits.has(item.rowIndex) &&
          edits.get(item.rowIndex)!.partNumber !== undefined
            ? edits.get(item.rowIndex)!.partNumber
            : item.partNumber;
        cappedItems.push({
          partNumber: partNumber || null,
          requested: remaining,
          available: available + maxVendorPull, // Total available from both sources
          capped: totalPulled,
        });
      }

      const existing = edits.get(item.rowIndex) || {};
      newEdits.set(
        item.rowIndex,
        clampAllocationsToSumRow(item, {
          ...existing,
          quantityPulledFromShop: shopPull,
          quantityPulledFromVendor: vendorPull,
          quantityPulled: totalPulled, // Keep for backward compatibility
          pulledBy: pullerName,
          pulledDate: getTodayDate(),
        }),
      );
    });

    setEdits(newEdits);

    // Show warning summary if any items were capped
    if (cappedCount > 0) {
      console.warn(
        `⚠️ Capped ${cappedCount} item(s) to available inventory.`,
        cappedItems,
      );
      // TODO: Show toast notification with summary
    }
  };

  // Store latest markAllPulled function in ref
  markAllPulledRef.current = markAllPulled;

  const getMaxFabAllowedForItem = (item: JobLineItem): number => {
    const needed = toNonNegativeInt(
      getCurrentFieldValue(item, "quantityNeeded") ?? item.quantityNeeded,
    );
    const currentFab = clampFab(
      getCurrentFieldValue(item, "quantityFab") ?? item.quantityFab,
      needed,
    );
    const shop = toNonNegativeInt(getPulledFromShop(item));
    const pre = toNonNegativeInt(getPulledFromPreorder(item));
    const v = toNonNegativeInt(getVendorReceivedForSum(item));
    const maxWithCurrentShop = Math.max(0, needed - shop - pre - v);
    // Allow moving qty from Shop→FAB even when the line is already covered via Shop.
    const maxIfShopMoved = Math.max(0, needed - pre - v);
    return Math.max(currentFab, maxWithCurrentShop, maxIfShopMoved);
  };

  // Check if item is pulled
  const isPulled = (item: JobLineItem) => {
    const needed = item.quantityNeeded || 0;
    const pulled = getCurrentValue(item);
    return pulled >= needed && needed > 0;
  };

  // Check if item is ordered
  const isOrdered = (item: JobLineItem) => {
    const edit = edits.get(item.rowIndex);
    if (edit && edit.ordered !== undefined) {
      return edit.ordered === "Yes";
    }
    return item.ordered?.toLowerCase() === "yes";
  };

  // Check if item is received from supplier
  const isReceived = (item: JobLineItem) => {
    const edit = edits.get(item.rowIndex);
    if (edit && edit.receivedFromOrder !== undefined) {
      return edit.receivedFromOrder === "Yes";
    }
    return item.receivedFromOrder?.toLowerCase() === "yes";
  };

  const isShopBlockedByOrder = (item: JobLineItem): boolean => {
    if (!isOrdered(item)) return false;

    const needed = toNonNegativeInt(
      getCurrentFieldValue(item, "quantityNeeded") ?? item.quantityNeeded,
    );
    if (needed <= 0) return true;

    const orderedQuantity = getQuantityOrderedForItem(item);
    if (orderedQuantity <= 0) return true;

    const received = toNonNegativeInt(getVendorReceivedForSum(item));
    if (received >= needed) return true;

    // Full-line vendor order with nothing received yet — wait on vendor or cancel first.
    if (orderedQuantity >= needed && received === 0) return true;

    // Partial vendor receipt with remaining need — allow shop to cover the gap.
    return false;
  };

  /** FAB covers full line qty — shop must not be used until FAB is reduced (same as vendor order). */
  const isShopBlockedByFab = (item: JobLineItem): boolean => {
    const needed = toNonNegativeInt(
      getCurrentFieldValue(item, "quantityNeeded") ?? item.quantityNeeded,
    );
    if (needed <= 0) return false;

    const fab = clampFab(
      getCurrentFieldValue(item, "quantityFab") ?? item.quantityFab,
      needed,
    );
    return fab >= needed;
  };

  /** Received pre-order pool has stock — use pre-order pull before shop inventory. */
  const isShopBlockedByPreorderPool = (item: JobLineItem): boolean =>
    jobPreorderFeaturesEnabled && getPreorderPoolAvailableForPart(item) > 0;

  const isShopPullBlocked = (item: JobLineItem): boolean =>
    isShopBlockedByOrder(item) ||
    isShopBlockedByFab(item) ||
    isShopBlockedByPreorderPool(item);

  const getShopBlockTitle = (item: JobLineItem, shopBlocked: boolean): string | undefined => {
    if (isShopBlockedByOrder(item)) {
      return "The vendor order covers the full line quantity. Cancel or reduce the order before pulling from shop.";
    }
    if (isShopBlockedByFab(item)) {
      return "FAB covers the full line quantity. Reduce FAB before pulling from shop.";
    }
    if (isShopBlockedByPreorderPool(item)) {
      const poolQty = getPreorderPoolAvailableForPart(item);
      return `Pre-order pool has ${poolQty} available for this part. Pull from Pre-Order Pull before pulling from shop inventory.`;
    }
    if (shopBlocked) {
      return "No shop pull left: remaining need is covered by vendor order/receipts, job pre-order, or FAB.";
    }
    return undefined;
  };

  const isLineCovered = (item: JobLineItem): boolean => getRemaining(item) <= 0;

  const getFabShopSnapshot = (item: JobLineItem, merge?: EditableFields) => {
    const needed = toNonNegativeInt(
      merge?.quantityNeeded ??
        getCurrentFieldValue(item, "quantityNeeded") ??
        item.quantityNeeded,
    );
    const fab = clampFab(
      merge?.quantityFab ??
        getCurrentFieldValue(item, "quantityFab") ??
        item.quantityFab,
      needed,
    );
    const shop = toNonNegativeInt(
      merge?.quantityPulledFromShop ??
        merge?.quantityPulled ??
        getPulledFromShop(item),
    );
    return { needed, fab, shop };
  };

  /** User tried to raise FAB/Shop on a line with no remaining need (not a column-to-column move). */
  const notifyIfFullyCoveredIncreaseBlocked = (
    item: JobLineItem,
    column: "FAB" | "Shop",
    requested: number,
    merged: EditableFields,
  ) => {
    if (!isLineCovered(item)) {
      setAllocationNotice(null);
      return;
    }
    const before = getFabShopSnapshot(item);
    const after = getFabShopSnapshot(item, merged);
    const beforeCol = column === "Shop" ? before.shop : before.fab;
    const afterCol = column === "Shop" ? after.shop : after.fab;

    if (requested <= beforeCol) {
      setAllocationNotice(null);
      return;
    }

    const netFabShopUp = after.fab + after.shop > before.fab + before.shop;
    const cappedBelowRequest = afterCol < requested;
    if (netFabShopUp || cappedBelowRequest) {
      const other = column === "Shop" ? "FAB" : "Shop";
      setAllocationNotice(
        `This line is fully covered. Decrease ${other} before increasing ${column}, or move quantity between columns without raising the total.`,
      );
      return;
    }
    setAllocationNotice(null);
  };

  const applyShopAllocationChange = (
    item: JobLineItem,
    requestedShop: number,
    originalShop: number,
    maxAllowed: number,
  ) => {
    if (!canPullFromShop || isSaving) return;
    let cappedShop = requestedShop;
    if (requestedShop > originalShop) {
      cappedShop = Math.min(requestedShop, maxAllowed);
    } else {
      cappedShop = Math.max(0, requestedShop);
    }

    const existing = edits.get(item.rowIndex) || {};
    const merged = clampAllocationsToSumRow(item, {
      ...existing,
      quantityPulledFromShop: cappedShop,
      quantityPulled: cappedShop + getPulledFromVendor(item),
      pulledBy: existing?.pulledBy ?? pullerName,
      pulledDate: existing?.pulledDate ?? getTodayDate(),
    });
    notifyIfFullyCoveredIncreaseBlocked(item, "Shop", requestedShop, merged);
    const newEdits = new Map(edits);
    newEdits.set(item.rowIndex, merged);
    setEdits(newEdits);
  };

  const canIncreaseFab = (item: JobLineItem): boolean => {
    if (!canEditLineItems || isSaving) return false;
    const needed = toNonNegativeInt(
      getCurrentFieldValue(item, "quantityNeeded") ?? item.quantityNeeded,
    );
    const currentFab = clampFab(
      getCurrentFieldValue(item, "quantityFab") ?? item.quantityFab,
      needed,
    );
    return getMaxFabAllowedForItem(item) > currentFab;
  };

  const canIncreaseShop = (item: JobLineItem): boolean => {
    if (!canPullFromShop || isSaving) return false;
    if (isShopPullBlocked(item)) return false;
    return getMaxShopPullForItem(item) > getPulledFromShop(item);
  };

  // Derived backorder flag (ordered but not received)
  const isBackordered = (item: JobLineItem) => {
    return isOrdered(item) && !isReceived(item);
  };

  const isPickupPending = (item: JobLineItem) => {
    return isBackordered(item) && item.pickupFromSupplier === true;
  };

  const isSupplierDeliveryPending = (item: JobLineItem) => {
    return isBackordered(item) && item.supplierDeliveryToJobsite === true;
  };

  // Effective quantity ordered for this line (from edit or item) - for parts-based counts
  const getQuantityOrderedForItem = (item: JobLineItem): number => {
    const edit = edits.get(item.rowIndex);
    if (edit?.quantityOrdered !== undefined && edit?.quantityOrdered !== null) {
      return Math.max(0, Number(edit.quantityOrdered));
    }
    const q = item.quantityOrdered;
    return (q != null && Number.isFinite(Number(q))) ? Math.max(0, Number(q)) : 0;
  };

  const getJobLineRequirementForItem = (item: JobLineItem): number =>
    toNonNegativeInt(
      getCurrentFieldValue(item, "quantityNeeded") ?? item.quantityNeeded,
    );

  /** Needed column always shows the original job line requirement (never vendor order qty). */
  const getNeededDisplayForItem = (item: JobLineItem): number =>
    getJobLineRequirementForItem(item);

  const getNeededDisplayTitle = (item: JobLineItem): string | undefined => {
    if (!isOrdered(item)) return undefined;
    const ordered = getQuantityOrderedForItem(item);
    const jobReq = getJobLineRequirementForItem(item);
    if (ordered > 0 && ordered !== jobReq) {
      return `Original needed: ${jobReq} · Vendor order: ${ordered} · See Remaining for what's left`;
    }
    if (ordered > 0) {
      return `Vendor order: ${ordered}`;
    }
    return undefined;
  };

  const isNeededLockedToVendorOrder = (item: JobLineItem): boolean =>
    isOrdered(item) && getQuantityOrderedForItem(item) > 0;

  // Per-item received label for action button (e.g. "20" or "15/20" for partial)
  const getReceivedLabelForItem = (item: JobLineItem): string => {
    const toNum = (n: number) => Math.max(0, Math.floor(n));
    const received = toNum(getPulledFromVendor(item));
    const ordered = toNum(getQuantityOrderedForItem(item));
    if (ordered > 0 && received < ordered) return `${received}/${ordered}`;
    return String(received);
  };

  const getVendorReceiveProgress = (item: JobLineItem) => {
    const ordered = toNonNegativeInt(getQuantityOrderedForItem(item));
    const received = toNonNegativeInt(getPulledFromVendor(item));
    return { ordered, received };
  };

  const isPartialVendorReceive = (item: JobLineItem): boolean => {
    const { ordered, received } = getVendorReceiveProgress(item);
    return isOrdered(item) && ordered > 0 && received > 0 && received < ordered;
  };

  // Demand-side cap for shop: needed − FAB − pulled pre-order − vendor received.
  // Shop is blocked entirely while FAB covers the line or received pre-order pool stock remains.
  const getMaxShopPullForItem = (item: JobLineItem): number => {
    const currentShop = toNonNegativeInt(getPulledFromShop(item));
    const needed = toNonNegativeInt(
      getCurrentFieldValue(item, "quantityNeeded") ?? item.quantityNeeded,
    );
    const v = toNonNegativeInt(getVendorReceivedForSum(item));
    const jobPo = toNonNegativeInt(getPulledFromPreorder(item));
    const fab = clampFab(getCurrentFieldValue(item, "quantityFab"), needed);

    if (fab >= needed && needed > 0) {
      return currentShop;
    }

    if (getPreorderPoolAvailableForPart(item) > 0) {
      return currentShop;
    }

    const maxWithCurrentFab = Math.max(0, needed - fab - jobPo - v);
    const maxIfFabMoved = Math.max(0, needed - jobPo - v);
    return Math.max(currentShop, maxWithCurrentFab, maxIfFabMoved);
  };

  const getShopPullNeededForItem = (item: JobLineItem): number => {
    const needed = toNonNegativeInt(
      getCurrentFieldValue(item, "quantityNeeded") ?? item.quantityNeeded,
    );
    const fab = clampFab(getCurrentFieldValue(item, "quantityFab"), needed);
    const shop = toNonNegativeInt(getPulledFromShop(item));
    const preorder = toNonNegativeInt(getPulledFromPreorder(item));
    const vendorAllocation = toNonNegativeInt(getVendorReceivedForSum(item));
    return getShopPullNeededQty({
      needed,
      fab,
      shop,
      preorder,
      vendorAllocation,
    });
  };

  const shouldShowShopPullHint = (
    item: JobLineItem,
    remaining: number,
  ): boolean => {
    const shopPullNeeded = getShopPullNeededForItem(item);
    if (shopPullNeeded <= 0) return false;
    if (shopPullNeeded === remaining) return false;
    const hasJobPreorder =
      toNonNegativeInt(getPulledFromPreorder(item)) > 0;
    return isOrdered(item) || hasJobPreorder;
  };

  const renderShopPullHint = (item: JobLineItem, remaining: number) => {
    if (!shouldShowShopPullHint(item, remaining)) return null;
    const shopPullNeeded = getShopPullNeededForItem(item);
    return (
      <span
        className="shrink-0 text-[8px] xl:text-[10px] font-semibold text-blue-600 dark:text-blue-300 leading-tight whitespace-nowrap tabular-nums"
        title="Qty to pull from shop after vendor order and/or job pre-order"
      >
        pull: {shopPullNeeded}
      </span>
    );
  };

  const isSupplierPickupComplete = (item: JobLineItem) => {
    if (item.pickupFromSupplier !== true) return false;
    // Pickup is complete when the line is no longer backordered (fully received)
    return !isBackordered(item);
  };

  // Can cancel order only when ordered, not received, and not yet in any Purchase Order
  const canCancelOrder = (item: JobLineItem): boolean => {
    if (!canOrderItems || isSaving) return false;
    if (!isOrdered(item) || isReceived(item)) return false;
    if (!item.partNumber) return false;
    const key = buildPoLineKey(item.jobNumber, item.listNumber, item.partNumber);
    return !(itemsInPurchaseOrders?.has(key) ?? false);
  };

  // Open cancel order confirmation modal
  const openCancelOrderModal = (item: JobLineItem) => {
    if (!canCancelOrder(item)) return;
    setItemToCancelOrder(item);
    setShowCancelOrderModal(true);
  };

  // Confirm cancel order - apply cancel and auto-save
  const handleConfirmCancelOrder = async () => {
    if (!itemToCancelOrder) return;

    const previousScrollY = captureOverviewScrollTop();

    if (typeof window !== "undefined") {
      try {
        const keyBase = `${window.location.pathname}${window.location.search || ""}`;
        const rowKey = `jobLastOrderedRow:${keyBase}`;
        window.sessionStorage.setItem(rowKey, String(itemToCancelOrder.rowIndex));
      } catch {
        // ignore storage errors
      }
    }

    const rowIndexToCancel = itemToCancelOrder.rowIndex;
    setCancellingOrderRowIndex(rowIndexToCancel);
    try {
      // Use quantityOrdered: 0 so the API persists it and Shop column unblocks (otherwise it stays disabled)
      const cancelPayload = { ordered: "" as const, quantityOrdered: 0 };
      const updates = new Map<number, EditableFields>([
        [rowIndexToCancel, cancelPayload],
      ]);
      // Optimistic update first so Shop field unblocks immediately (before parent refetch)
      setEdits((prev) => {
        const next = new Map(prev);
        const existing = next.get(rowIndexToCancel) || {};
        next.set(rowIndexToCancel, { ...existing, ...cancelPayload });
        return next;
      });
      setShowCancelOrderModal(false);
      setItemToCancelOrder(null);
      await onSave(updates);
      await refreshInventoryQuantities({ silent: true });

      restoreOverviewScrollAfterPaint(previousScrollY);
    } catch (err) {
      // Parent handles error display; keep modal open for retry
    } finally {
      setCancellingOrderRowIndex(null);
    }
  };

  // Check if item can be ordered
  const canOrderItem = (item: JobLineItem): boolean => {
    if (!canOrderItems || isSaving) return false;
    if (!item.partNumber || item.partNumber.trim() === "") return false;
    if (isOrdered(item)) return false;
    return !isLineCovered(item);
  };

  const buildOrderEditForItem = (
    item: JobLineItem,
    quantity: number,
    existingEdits: Map<number, EditableFields> = edits,
  ): EditableFields => {
    const existing = existingEdits.get(item.rowIndex) || {};

    return {
      ...existing,
      ordered: "Yes",
      quantityOrdered: quantity,
    };
  };

  const orderAllEligible = useMemo(() => {
    const source = bulkActionLineItems ?? lineItems;
    let count = 0;
    let totalQty = 0;
    for (const item of source) {
      if (!canOrderItem(item)) continue;
      const remaining = getRemaining(item);
      if (remaining <= 0) continue;
      count += 1;
      totalQty += remaining;
    }
    return { count, totalQty };
  }, [
    bulkActionLineItems,
    lineItems,
    edits,
    canOrderItems,
    isSaving,
    jobPreorderPoolAvailable,
  ]);

  const openOrderAllModal = () => {
    if (orderAllEligible.count === 0) return;

    const source = bulkActionLineItems ?? lineItems;
    const pendingEdits = new Map<number, EditableFields>();
    const rowIndexes: number[] = [];
    let eligibleCount = 0;
    let totalQty = 0;

    for (const item of source) {
      if (!canOrderItem(item)) continue;
      const remaining = getRemaining(item);
      if (remaining <= 0) continue;

      eligibleCount += 1;
      totalQty += remaining;
      rowIndexes.push(item.rowIndex);
      pendingEdits.set(
        item.rowIndex,
        buildOrderEditForItem(item, remaining, edits),
      );
    }

    if (eligibleCount === 0) return;

    orderAllPendingEditsRef.current = pendingEdits;
    orderAllRowIndexesRef.current = rowIndexes;
    setOrderAllSummary({
      eligibleCount,
      totalQty,
      skippedCount: source.length - eligibleCount,
    });
    setShowOrderAllModal(true);
  };

  const confirmOrderAll = async () => {
    const pending = orderAllPendingEditsRef.current;
    if (!pending || pending.size === 0) return;

    const previousScrollY = captureOverviewScrollTop();
    const affectedRowIndexes = [...orderAllRowIndexesRef.current];
    const newEdits = new Map(edits);
    pending.forEach((edit, rowIndex) => {
      newEdits.set(rowIndex, edit);
    });

    setShowOrderAllModal(false);
    setOrderAllSummary(null);
    orderAllPendingEditsRef.current = null;
    orderAllRowIndexesRef.current = [];

    const mismatches = checkVendorMismatches(newEdits);
    setEdits(newEdits);

    try {
      if (mismatches.length > 0) {
        setVendorMismatches(mismatches);
        setShowVendorWarning(true);
        return;
      }

      await onSave(newEdits);
      setEdits(new Map());
      setShowVendorWarning(false);
      setVendorMismatches([]);
      await refreshInventoryQuantities({ silent: true });
      restoreOverviewScrollAfterPaint(previousScrollY);
    } catch (err) {
      console.error("Error ordering all remaining parts:", err);
      setEdits((prev) => {
        const reverted = new Map(prev);
        for (const rowIndex of affectedRowIndexes) {
          if (edits.has(rowIndex)) {
            reverted.set(rowIndex, edits.get(rowIndex)!);
          } else {
            reverted.delete(rowIndex);
          }
        }
        return reverted;
      });
    }
  };

  orderAllRef.current = openOrderAllModal;

  // Expose toolbar data to parent component
  useEffect(() => {
    if (onToolbarData) {
      onToolbarData({
        listedBy: listedByDisplay,
        onPullAll: () => markAllPulledRef.current?.(),
        onOrderAll: () => orderAllRef.current?.(),
        orderAllEligibleCount: orderAllEligible.count,
      });
    }
  }, [listedByDisplay, onToolbarData, orderAllEligible.count]);

  const getVendorOrderStatusPill = (
    item: JobLineItem,
  ): {
    label: string;
    shortLabel?: string;
    sublabel?: string;
    className: string;
    title: string;
  } | null => {
    const orderedQty = getQuantityOrderedForItem(item);
    const receivedLabel = getReceivedLabelForItem(item);
    const { ordered, received } = getVendorReceiveProgress(item);

    if (isPartialVendorReceive(item)) {
      return {
        label: `Partial ${received}/${ordered}`,
        shortLabel: `${received}/${ordered}`,
        className:
          "bg-amber-50 dark:bg-amber-950/50 border-amber-400/70 text-amber-950 dark:text-amber-100 ring-1 ring-amber-400/30",
        title: `Partially received: ${received} of ${ordered} from vendor order (${ordered - received} still pending)`,
      };
    }

    if (isReceived(item)) {
      return {
        label: `Rcvd ${receivedLabel}`,
        shortLabel: `Rcvd ${receivedLabel}`,
        className:
          "bg-green-50 dark:bg-green-900/30 border-green-500/50 text-green-900 dark:text-green-100",
        title: `${receivedLabel} received from vendor (included in remaining)`,
      };
    }
    if (isOrdered(item)) {
      if (isSupplierDeliveryPending(item)) {
        return {
          label: `Delivery ${orderedQty}`,
          shortLabel: `Del ${orderedQty}`,
          className:
            "bg-pink-50 dark:bg-pink-900/30 border-pink-500/50 text-pink-900 dark:text-pink-100",
          title: `Supplier delivery to jobsite — ${orderedQty} on order, pending receive (in PO)`,
        };
      }
      if (isPickupPending(item)) {
        return {
          label: `Pickup ${orderedQty}`,
          shortLabel: `P/U ${orderedQty}`,
          className:
            "bg-orange-50 dark:bg-orange-900/30 border-orange-500/50 text-orange-900 dark:text-orange-100",
          title: `Pickup required — ${orderedQty} on order, pending receive (in PO)`,
        };
      }
      return {
        label: `In PO ${orderedQty}`,
        shortLabel: `PO ${orderedQty}`,
        className:
          "bg-blue-50 dark:bg-blue-900/30 border-blue-500/50 text-blue-900 dark:text-blue-100",
        title: `${orderedQty} on vendor order — in purchase order, manage from Orders`,
      };
    }
    return null;
  };

  const getVendorOrderMutedReason = (
    item: JobLineItem,
  ): { label: string; title: string } | null => {
    if (!item.partNumber || item.partNumber.trim() === "") {
      return {
        label: "No part",
        title: "Enter a part number before ordering from a vendor",
      };
    }
    if (isLineCovered(item)) {
      return {
        label: "Covered",
        title: "Remaining need is fully covered by FAB, shop, pre-order, or vendor",
      };
    }
    return null;
  };

  const renderVendorOrderPill = (
    label: string,
    className: string,
    title: string,
    variant: "mobile" | "desktop",
    sublabel?: string,
    shortLabel?: string,
  ) => {
    const text = sublabel ? `${label} ${sublabel}` : label;
    const compactText = shortLabel ?? text;
    const forceCompactDesktopText =
      variant === "desktop" && typeof shortLabel === "string" && text.startsWith("Partial ");
    return (
      <div
        className={`${
          variant === "mobile"
            ? "w-full px-3 py-2 rounded-lg text-center font-semibold tabular-nums whitespace-nowrap"
            : "w-full max-w-full px-1 py-0.5 lg:px-1.5 lg:py-1 xl:px-2 xl:py-1 border rounded text-center text-[9px] lg:text-[10px] xl:text-xs font-semibold tabular-nums leading-none whitespace-nowrap overflow-hidden text-ellipsis"
        } ${className}`}
        title={title}
      >
        {forceCompactDesktopText ? (
          compactText
        ) : variant === "desktop" && shortLabel ? (
          <>
            <span className="xl:hidden">{compactText}</span>
            <span className="hidden xl:inline">{text}</span>
          </>
        ) : (
          text
        )}
      </div>
    );
  };

  const renderVendorOrderControl = (
    item: JobLineItem,
    variant: "mobile" | "desktop",
  ) => {
    const remaining = getRemaining(item);
    const orderedQty = getQuantityOrderedForItem(item);
    const statusPill = getVendorOrderStatusPill(item);
    const mutedReason = getVendorOrderMutedReason(item);

    const pillButtonClass =
      variant === "mobile"
        ? "w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        : "w-full max-w-full inline-flex items-center justify-center gap-0.5 lg:gap-1 px-1 py-0.5 lg:px-1.5 lg:py-1 xl:px-2 xl:py-1 rounded border text-[9px] lg:text-[10px] xl:text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden";

    if (!canOrderItems) {
      if (statusPill) {
        return renderVendorOrderPill(
          statusPill.label,
          statusPill.className,
          statusPill.title,
          variant,
          statusPill.sublabel,
          statusPill.shortLabel,
        );
      }
      return renderVendorOrderPill(
        "—",
        "bg-slate-100 dark:bg-slate-800/50 border-slate-300 dark:border-slate-600/50 text-slate-500 dark:text-slate-400",
        "Order line items permission required",
        variant,
      );
    }

    if (canOrderItem(item)) {
      return (
        <button
          type="button"
          onClick={() => handleOrderItem(item)}
          disabled={isSaving}
          title={`Order ${remaining} remaining from vendor`}
          aria-label={`Order ${remaining} from vendor`}
          className={`${pillButtonClass} border-blue-500/60 bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-sm hover:shadow-md hover:from-blue-600 hover:to-blue-700`}
        >
          <svg
            className={
              variant === "mobile" ? "w-5 h-5 shrink-0" : "w-4 h-4 xl:w-5 xl:h-5 shrink-0"
            }
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path d="M2.5 3.5h2.2l1.7 9a1.8 1.8 0 0 0 1.8 1.5h6.8" />
            <path d="M7 7.5h5" />
            <circle cx="8.5" cy="19" r="1.4" />
            <circle cx="15.5" cy="19" r="1.4" />
          </svg>
          <span className="tabular-nums">
            {variant === "mobile" ? (
              `Order ${remaining}`
            ) : (
              <>
                <span className="xl:hidden">{remaining}</span>
                <span className="hidden xl:inline">Order {remaining}</span>
              </>
            )}
          </span>
        </button>
      );
    }

    if (isOrdered(item) && canCancelOrder(item)) {
      return (
        <button
          type="button"
          onClick={() => openCancelOrderModal(item)}
          disabled={isSaving}
          title={`Cancel vendor order for ${orderedQty} (not yet in a purchase order)`}
          aria-label={`Cancel vendor order for ${orderedQty}`}
          className={`${pillButtonClass} border-amber-500/60 bg-amber-50 dark:bg-amber-950/40 text-amber-950 dark:text-amber-100 hover:bg-amber-100 dark:hover:bg-amber-900/50`}
        >
          <span className="tabular-nums">
            {variant === "mobile" ? (
              `On order ${orderedQty}`
            ) : (
              <>
                <span className="xl:hidden">{orderedQty}</span>
                <span className="hidden xl:inline">Cancel {orderedQty}</span>
              </>
            )}
          </span>
          {variant === "mobile" ? (
            <span className="text-xs font-medium opacity-80">· tap to cancel</span>
          ) : null}
        </button>
      );
    }

    if (statusPill) {
      return renderVendorOrderPill(
        statusPill.label,
        statusPill.className,
        statusPill.title,
        variant,
        statusPill.sublabel,
        statusPill.shortLabel,
      );
    }

    if (mutedReason) {
      return renderVendorOrderPill(
        mutedReason.label,
        "bg-slate-100 dark:bg-slate-800/60 border-slate-300 dark:border-slate-600/50 text-slate-600 dark:text-slate-400",
        mutedReason.title,
        variant,
        undefined,
        mutedReason.label === "Covered" ? "Cov" : mutedReason.label,
      );
    }

    return renderVendorOrderPill(
      "—",
      "bg-slate-50 dark:bg-slate-900/30 border-slate-200 dark:border-slate-700/50 text-slate-400 dark:text-slate-500",
      "No vendor order for this line",
      variant,
    );
  };

  // Handle opening order modal
  const handleOrderItem = (item: JobLineItem) => {
    if (!canOrderItem(item)) return;

    const remaining = getRemaining(item);
    if (remaining <= 0) return;

    // Set modal state
    setOrderModalItem(item);
    setOrderQuantity(remaining);
    setShowOrderModal(true);
  };

  // Handle confirming order with specified quantity
  const handleConfirmOrder = async (quantity: number) => {
    if (!orderModalItem) return;

    const remaining = getRemaining(orderModalItem);

    // Validate quantity
    if (quantity <= 0 || quantity > remaining) {
      // Validation error - could show a toast here
      return;
    }

    const previousScrollY = captureOverviewScrollTop();

    // Stash last ordered row so we can scroll it into view if the page remounts after save.
    if (typeof window !== "undefined") {
      try {
        const keyBase = `${window.location.pathname}${window.location.search || ""}`;
        const rowKey = `jobLastOrderedRow:${keyBase}`;
        window.sessionStorage.setItem(rowKey, String(orderModalItem.rowIndex));
      } catch {
        // ignore storage errors
      }
    }

    const item = orderModalItem;

    // Update edits map with ordered status and quantityOrdered
    const newEdits = new Map(edits);
    const existing = edits.get(item.rowIndex) || {};

    // Only ordered/quantityOrdered are actually changing here. `...existing`
    // already carries forward any genuinely pending pull edits for this row
    // (e.g. quantityPulled/pulledBy/pulledDate) — synthesizing those from
    // the current DB value when they're NOT already pending would make a
    // pure ordering action look like a shop-pull edit too, which incorrectly
    // requires the "Pull From Shop" permission on top of "Order Line Items".
    newEdits.set(item.rowIndex, {
      ...existing,
      ordered: "Yes",
      quantityOrdered: quantity,
    });

    // Check for vendor mismatches with the new edits
    const tempMismatches: Array<{
      partNumber: string;
      description: string | null;
      databaseVendor: string;
      userVendor: string;
    }> = [];
    lineItems.forEach((li) => {
      const edit = newEdits.get(li.rowIndex) ?? edits.get(li.rowIndex);
      const currentPartNumber = edit?.partNumber ?? li.partNumber;
      const currentVendor = edit?.type ?? li.type;

      if (currentPartNumber && currentVendor) {
        const normalizedPN = currentPartNumber
          .replace(/[\s\t\r\n]+/g, "")
          .toUpperCase()
          .trim();
        const databaseVendor =
          vendorData.get(normalizedPN) ||
          vendorData.get(currentPartNumber.trim()) ||
          vendorData.get(currentPartNumber);

        if (
          databaseVendor &&
          normalizeVendorKey(databaseVendor) !== normalizeVendorKey(currentVendor)
        ) {
          tempMismatches.push({
            partNumber: currentPartNumber,
            description: edit?.description ?? li.description ?? null,
            databaseVendor,
            userVendor: currentVendor,
          });
        }
      }
    });

    setEdits(newEdits);
    setShowOrderModal(false);
    setOrderModalItem(null);

    // Immediately save the changes
    try {
      if (tempMismatches.length > 0) {
        // If there are mismatches, show warning modal
        setVendorMismatches(tempMismatches);
        setShowVendorWarning(true);
        // Note: performSave will be called when user confirms in the warning modal
        return;
      }

      // No mismatches, proceed with save using the new edits
      // quantityOrdered is already set correctly in newEdits from the modal input
      await onSave(newEdits);
      setEdits(new Map()); // Clear edits after successful save
      setShowVendorWarning(false);
      setVendorMismatches([]);
      await refreshInventoryQuantities({ silent: true });

      restoreOverviewScrollAfterPaint(previousScrollY);
    } catch (err) {
      console.error("Error ordering item:", err);
      // Revert the edit on error
      const revertedEdits = new Map(edits);
      revertedEdits.delete(item.rowIndex);
      setEdits(revertedEdits);
    }
  };

  // Get current vendor value (from edits, saved item.type, or vendorData fallback)
  const getCurrentVendor = (item: JobLineItem) => {
    const edit = edits.get(item.rowIndex);
    const currentPartNumber = edit?.partNumber ?? item.partNumber;

    // If there's an edit with type, use it (user may have manually changed it)
    if (edit && edit.type !== undefined) {
      return edit.type;
    }

    // If item.type is set (saved vendor), respect it — don't override with vendorData.
    // This preserves intentionally saved vendor overrides (e.g., user saved "Core & Main"
    // even though the parts DB says "Etna").
    if (item.type && item.type.trim() !== "") {
      return item.type;
    }

    // No saved vendor — try to get vendor from database based on part number
    if (currentPartNumber) {
      const normalizedPN = currentPartNumber
        .replace(/[\s\t\r\n]+/g, "")
        .toUpperCase()
        .trim();
      const vendor =
        vendorData.get(normalizedPN) ||
        vendorData.get(currentPartNumber.trim()) ||
        vendorData.get(currentPartNumber);
      if (vendor) {
        return vendor;
      }
    }

    // Fall back to empty
    return "";
  };

  // Check if current vendor is "Other" (custom vendor)
  const isCustomVendor = (item: JobLineItem) => {
    const currentVendor = getCurrentVendor(item);
    return (
      currentVendor &&
      !allVendors.includes(normalizeVendorKey(currentVendor)) &&
      currentVendor !== ""
    );
  };

  // Get display value for dropdown (either the vendor or "Other")
  const getVendorDropdownValue = (item: JobLineItem) => {
    // If user has manually selected any vendor, use the edit value directly
    if (manualVendorSelections.has(item.rowIndex)) {
      const edit = edits.get(item.rowIndex);
      if (edit?.type !== undefined) {
        const normalized = normalizeVendorKey(edit.type);
        // If it's a known vendor, return the lowercase key; otherwise show "Other"
        if (allVendors.includes(normalized)) return normalized;
        return "Other";
      }
      return "Other";
    }

    const currentVendor = getCurrentVendor(item);
    if (!currentVendor) return "";
    // If vendor is in the list (compare normalized), return it; otherwise return "Other"
    return allVendors.includes(normalizeVendorKey(currentVendor))
      ? normalizeVendorKey(currentVendor)
      : "Other";
  };

  // Has unsaved changes
  const hasChanges = edits.size > 0;

  useEffect(() => {
    onUnsavedChangesChange?.(hasChanges);
  }, [hasChanges, onUnsavedChangesChange]);

  useEffect(() => {
    return () => onUnsavedChangesChange?.(false);
  }, [onUnsavedChangesChange]);

  // Check for vendor mismatches before saving
  const checkVendorMismatches = (
    editsMap: Map<number, EditableFields> = edits,
  ): Array<{
    partNumber: string;
    description: string | null;
    databaseVendor: string;
    userVendor: string;
  }> => {
    const mismatches: Array<{
      partNumber: string;
      description: string | null;
      databaseVendor: string;
      userVendor: string;
    }> = [];

    editsMap.forEach((edit, rowIndex) => {
      const item = resolveLineItem(rowIndex);
      if (!item) return;

      const currentPartNumber = edit?.partNumber ?? item.partNumber;
      const currentVendor = edit?.type ?? item.type;

      if (currentPartNumber && currentVendor) {
        const normalizedPN = currentPartNumber
          .replace(/[\s\t\r\n]+/g, "")
          .toUpperCase()
          .trim();
        const databaseVendor =
          vendorData.get(normalizedPN) ||
          vendorData.get(currentPartNumber.trim()) ||
          vendorData.get(currentPartNumber);

        if (
          databaseVendor &&
          normalizeVendorKey(databaseVendor) !== normalizeVendorKey(currentVendor)
        ) {
          mismatches.push({
            partNumber: currentPartNumber,
            description: edit?.description ?? item.description ?? null,
            databaseVendor,
            userVendor: currentVendor,
          });
        }
      }
    });

    return mismatches;
  };

  // Handle save
  const handleSave = async (): Promise<boolean> => {
    // Check for vendor mismatches
    const mismatches = checkVendorMismatches();

    if (mismatches.length > 0) {
      setVendorMismatches(mismatches);
      setShowVendorWarning(true);
      return false;
    }

    // No mismatches, proceed with save
    return performSave();
  };

  // Perform the actual save
  const performSave = async (
    editsOverride?: Map<number, EditableFields>,
  ): Promise<boolean> => {
    const sourceEdits = editsOverride ?? edits;
    const finalEdits = new Map(sourceEdits);

    finalEdits.forEach((edit, rowIndex) => {
      const item = resolveLineItem(rowIndex);
      if (!item) return;

      if (edit.ordered === "Yes") {
        // If ordered, preserve persisted PO qty when edit omits it; never replace with 0
        // just because vendor commitment already fills the sum in getRemaining().
        if (edit.quantityOrdered === undefined) {
          const persisted =
            item.quantityOrdered != null &&
            Number.isFinite(Number(item.quantityOrdered))
              ? Math.max(0, Number(item.quantityOrdered))
              : 0;
          finalEdits.set(rowIndex, {
            ...edit,
            quantityOrdered:
              persisted > 0 ? persisted : Math.max(0, getRemaining(item)),
          });
        }
        // If quantityOrdered is already set, keep it as is
      } else if (edit.ordered === "") {
        // Explicitly not ordered — clear quantityOrdered
        finalEdits.set(rowIndex, {
          ...edit,
          quantityOrdered: undefined,
        });
      }
    });

    const previousScrollY = captureOverviewScrollTop();
    await onSave(finalEdits);
    setEdits(new Map()); // Clear edits after successful save
    setShowVendorWarning(false);
    setVendorMismatches([]);
    await refreshInventoryQuantities({ silent: true });
    restoreOverviewScrollAfterPaint(previousScrollY);
    return true;
  };

  const saveRequestRef = useRef<
    (opts?: { silent?: boolean }) => Promise<boolean>
  >(async () => false);
  saveRequestRef.current = async (_opts?: { silent?: boolean }) => {
    try {
      return await handleSave();
    } catch {
      return false;
    }
  };

  useEffect(() => {
    if (!registerSaveHandler) return;
    registerSaveHandler((opts) => saveRequestRef.current(opts));
    return () => registerSaveHandler(null);
  }, [registerSaveHandler]);

  // Fetch all vendors list on mount
  useEffect(() => {
    const fetchAllVendors = async () => {
      try {
        const response = await fetch("/api/parts/vendors");
        if (response.ok) {
          const data = await response.json();
          setAllVendors(data.vendors || []);
        }
      } catch (err) {
        if (process.env.NODE_ENV === "development") {
          console.error("Error fetching vendors list:", err);
        }
      }
    };

    fetchAllVendors();
  }, []);

  // Track previous part numbers to avoid unnecessary API calls
  const previousPartNumbersRef = useRef<string>("");
  const previousInventoryPartNumbersRef = useRef<string>("");

  // Compute current part numbers string - only changes when part numbers actually change
  const currentPartNumbersString = useMemo(() => {
    const allPartNumbers = new Set<string>();
    lineItems.forEach((item) => {
      const partNumber =
        edits.has(item.rowIndex) &&
        edits.get(item.rowIndex)!.partNumber !== undefined
          ? edits.get(item.rowIndex)!.partNumber
          : item.partNumber;
      if (partNumber) {
        allPartNumbers.add(partNumber);
      }
    });
    return Array.from(allPartNumbers).sort().join(",");
  }, [
    // Depend on lineItems part numbers
    lineItems.map((item) => item.partNumber || "").join("|"),
    // Depend only on partNumber changes in edits, not other fields
    Array.from(edits.entries())
      .map(([rowIndex, edit]) =>
        edit.partNumber !== undefined ? `${rowIndex}:${edit.partNumber}` : "",
      )
      .filter((s) => s)
      .sort()
      .join("|"),
  ]);

  // Fetch vendor data for all part numbers (only when part numbers actually change)
  useEffect(() => {
    const fetchVendorData = async () => {
      // Only fetch if part numbers have actually changed
      if (currentPartNumbersString === previousPartNumbersRef.current) {
        return; // Part numbers haven't changed, skip fetch
      }

      // Update ref with current part numbers
      previousPartNumbersRef.current = currentPartNumbersString;

      if (!currentPartNumbersString) {
        setVendorData(new Map());
        return;
      }

      const partNumbersArray = currentPartNumbersString
        .split(",")
        .filter((p) => p);

      try {
        const response = await fetch(
          `/api/parts/suppliers?partNumbers=${encodeURIComponent(partNumbersArray.join(","))}`,
        );
        if (response.ok) {
          const data = await response.json();
          const vendorMap = new Map<string, string>(
            Object.entries(data.suppliers || {}),
          );
          setVendorData(vendorMap);
        }
      } catch (err) {
        if (process.env.NODE_ENV === "development") {
          console.error("Error fetching vendor data:", err);
        }
      }
    };

    fetchVendorData();
  }, [currentPartNumbersString]);

  const refreshInventoryQuantities = useCallback(
    async (opts?: {
      silent?: boolean;
    }): Promise<Map<string, number> | null> => {
      if (!currentPartNumbersString) {
        setInventoryQuantities(new Map());
        setInventoryErrors(new Map());
        previousInventoryPartNumbersRef.current = "";
        return new Map();
      }

      const partNumbersArray = currentPartNumbersString
        .split(",")
        .filter((p) => p);
      if (partNumbersArray.length === 0) {
        setInventoryQuantities(new Map());
        setInventoryErrors(new Map());
        previousInventoryPartNumbersRef.current = "";
        return new Map();
      }

      if (!opts?.silent) {
        setInventoryLoading(true);
      }
      const newErrors = new Map<string, string>();

      try {
        const response = await fetch(
          `/api/parts/inventory-quantities?partNumbers=${encodeURIComponent(partNumbersArray.join(","))}`,
        );
        if (response.ok) {
          const data = await response.json();
          const inventoryMap = new Map<string, number>();

          Object.entries(data || {}).forEach(([partNumber, quantity]) => {
            if (quantity === null || quantity === undefined) {
              newErrors.set(partNumber, "Part not found in inventory");
              inventoryMap.set(partNumber, 0);
            } else {
              inventoryMap.set(partNumber, Number(quantity) || 0);
            }
          });

          setInventoryQuantities(inventoryMap);
          setInventoryErrors(newErrors);
          previousInventoryPartNumbersRef.current = currentPartNumbersString;
          return inventoryMap;
        }

        if (!opts?.silent) {
          const errorText = await response.text();
          console.error("Error fetching inventory quantities:", errorText);
          partNumbersArray.forEach((pn) => {
            newErrors.set(pn, "Failed to fetch inventory");
          });
          setInventoryErrors(newErrors);
        }
        return null;
      } catch (err) {
        if (!opts?.silent) {
          console.error("Error fetching inventory quantities:", err);
          partNumbersArray.forEach((pn) => {
            newErrors.set(pn, "Network error fetching inventory");
          });
          setInventoryErrors(newErrors);
        } else {
          console.error("Error refreshing inventory (non-blocking):", err);
        }
        return null;
      } finally {
        if (!opts?.silent) {
          setInventoryLoading(false);
        }
      }
    },
    [currentPartNumbersString],
  );

  const refreshInventoryQuantitiesRef = useRef(refreshInventoryQuantities);
  refreshInventoryQuantitiesRef.current = refreshInventoryQuantities;

  // Fetch inventory quantities for all part numbers (only when part numbers actually change)
  useEffect(() => {
    if (currentPartNumbersString === previousInventoryPartNumbersRef.current) {
      return;
    }
    void refreshInventoryQuantities();
  }, [currentPartNumbersString, refreshInventoryQuantities]);

  // Periodic inventory refresh (every 30 seconds while editing, paused when tab inactive)
  useEffect(() => {
    // Only refresh if there are pending edits
    if (edits.size === 0) {
      return;
    }

    const fetchInventoryQuantities = async () => {
      if (!currentPartNumbersString) {
        return;
      }

      const partNumbersArray = currentPartNumbersString
        .split(",")
        .filter((p) => p);
      if (partNumbersArray.length === 0) {
        return;
      }

      const oldQuantities = inventoryQuantities;
      const refreshed = await refreshInventoryQuantities({ silent: true });
      if (!refreshed) return;

      const warnings: string[] = [];
      lineItems.forEach((item) => {
        const partNumber =
          edits.has(item.rowIndex) &&
          edits.get(item.rowIndex)!.partNumber !== undefined
            ? edits.get(item.rowIndex)!.partNumber
            : item.partNumber;

        if (partNumber) {
          const oldQuantity = oldQuantities.get(partNumber) ?? 0;
          const newQuantity = refreshed.get(partNumber) ?? 0;
          const currentShopPulled = getPulledFromShop(item);

          if (
            newQuantity < oldQuantity &&
            newQuantity < currentShopPulled
          ) {
            warnings.push(
              `Inventory for ${partNumber} decreased (now ${newQuantity}, trying to pull ${currentShopPulled})`,
            );
          }
        }
      });

      if (warnings.length > 0) {
        console.warn("⚠️ Inventory decreased below current pulls:", warnings);
      }
    };

    // Use Page Visibility API to pause polling when tab is not visible
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab is hidden - pause polling
        if (intervalId !== null) {
          clearInterval(intervalId);
          intervalId = null;
        }
      } else {
        // Tab is visible again - resume polling
        if (intervalId === null && edits.size > 0) {
          intervalId = window.setInterval(fetchInventoryQuantities, 30000);
        }
      }
    };

    let intervalId: number | null = null;

    // Start initial interval if tab is visible
    if (!document.hidden) {
      intervalId = window.setInterval(fetchInventoryQuantities, 30000);
    }

    // Listen for visibility changes
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    edits.size,
    currentPartNumbersString,
    inventoryQuantities,
    lineItems,
    refreshInventoryQuantities,
  ]);

  // Reset edits when lineItems change (e.g., after save or job change)
  // Also restore "Other" selections for items with custom vendors
  useEffect(() => {
    setEdits(new Map());

    // Restore "Other" selections for items that have vendor values not in the allVendors list
    const restoredCustomVendors = new Map<number, string>();
    const restoredManualVendorSelections = new Set<number>();

    if (allVendors.length > 0) {
      lineItems.forEach((item) => {
        if (
          item.type &&
          item.type.trim() !== "" &&
          !allVendors.includes(normalizeVendorKey(item.type))
        ) {
          // This is a custom vendor - restore it as "Other"
          restoredCustomVendors.set(item.rowIndex, item.type);
          restoredManualVendorSelections.add(item.rowIndex);
        }
      });
    }

    setCustomVendors(restoredCustomVendors);
    setManualVendorSelections(restoredManualVendorSelections);
    void refreshInventoryQuantitiesRef.current({ silent: true });
  }, [
    lineItems,
    allVendors,
    discardChangesSignal,
  ]);

  if (filteredItems.length === 0) {
    const isLikelyNoPartsJob =
      lineItems.length === 0 &&
      !showUnpulledOnly &&
      (!activeFilter || activeFilter === "all");

    const emptyMessage = isLikelyNoPartsJob
      ? "No parts for this job yet."
      : showUnpulledOnly
        ? "No unfulfilled paths match this filter."
        : activeFilter && activeFilter !== "all"
          ? "No items match this filter. Try All, Fully Pulled, Ordered, or Remaining above."
          : "No line items to display.";
    return (
      <div className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 rounded-xl p-8 sm:p-12 text-center backdrop-blur-sm shadow-xl">
        <div className="text-2xl mb-3"></div>
        <div className="text-lg font-bold text-slate-900 dark:text-white">
          {emptyMessage}
        </div>
        {isLikelyNoPartsJob && (canAddLineItems || emptyStateActions) && (
          <div className="mt-6 space-y-4">
            {emptyStateActions}
            {onAddLineItem && canAddLineItems && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={onAddLineItem}
                  disabled={isSaving}
                  className="px-5 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-lg bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white shadow-purple-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  + Add Part Manually
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  const stickyHeaderCellClass =
    "bg-blue-500 dark:bg-blue-600";

  /** Shared column widths for split header/body overview tables (must match exactly). */
  const overviewDesktopColGroup = (
    <colgroup>
      {canReorderRows ? <col style={{ width: 28 }} /> : null}
      <col style={{ width: "10%" }} />
      <col style={{ width: "18%" }} />
      <col style={{ width: "2.75rem" }} />
      <col style={{ width: "4.75rem" }} />
      <col style={{ width: "4.75rem" }} />
      <col style={{ width: "4.75rem" }} />
      {jobPreorderFeaturesEnabled ? (
        <col style={{ width: "4.25rem" }} />
      ) : null}
      <col style={{ width: "7.5%" }} />
      <col style={{ width: "4.25rem" }} />
      <col style={{ width: "5rem" }} />
      <col style={{ width: "8%" }} />
      {canDeleteParts ? <col style={{ width: 32 }} /> : null}
    </colgroup>
  );

  const overviewHeaderCell =
    "px-0.5 py-1.5 lg:px-1 lg:py-2 xl:px-3 xl:py-3 text-[8px] lg:text-[9px] xl:text-xs font-bold uppercase tracking-tight xl:tracking-wider";

  const overviewQtyInputClass =
    "overview-qty-input w-full min-w-0 px-1.5 py-0.5 lg:px-2 lg:py-1 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded text-[10px] xl:text-sm text-center font-semibold tabular-nums leading-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 dark:disabled:bg-slate-800/50";

  const overviewUomInputClass =
    "overview-uom-input w-full min-w-0 max-w-[2.75rem] mx-auto px-0.5 py-0.5 lg:py-1 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded text-[10px] xl:text-xs text-center font-semibold uppercase tracking-tight leading-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 dark:disabled:bg-slate-800/50 placeholder:text-slate-500 dark:placeholder:text-slate-500";

  return (
    <div className="flex-1 flex flex-col gap-3 sm:gap-4 min-h-0 overflow-hidden">

      {/* Mobile / portrait tablet cards — table layout from lg (1024px) up */}
      <div className="lg:hidden flex-1 min-h-0 overflow-y-auto gap-3 flex flex-col">
        {displayedItems.map((item) => {
          const remaining = getRemaining(item);
          const pulled = isPulled(item);
          const ordered = isOrdered(item);
          const received = isReceived(item);
          const hasRemaining = remaining > 0;

          return (
            <div
              key={item.rowIndex}
              className={`border rounded-2xl p-4 shadow-lg transition-all transform hover:scale-[1.01] ${
                hasRemaining
                  ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-600/50 shadow-xl"
                  : "bg-white dark:bg-slate-800/60 border-gray-200 dark:border-slate-700/50"
              }`}
            >
              {/* Part Info - Editable */}
              <div className="mb-3 pb-3 border-b border-gray-200 dark:border-slate-600/50 space-y-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-900 dark:text-slate-300 mb-1">
                    Part Number
                  </label>
                  <input
                    type="text"
                    value={getCurrentFieldValue(item, "partNumber") || ""}
                    onChange={(e) => {
                      updateField(item.rowIndex, "partNumber", e.target.value);
                      // Auto-update vendor when part number changes (if vendor data is available)
                      const newPartNumber = e.target.value;
                      if (newPartNumber && vendorData.size > 0) {
                        const normalizedPN = newPartNumber
                          .replace(/[\s\t\r\n]+/g, "")
                          .toUpperCase()
                          .trim();
                        const vendor =
                          vendorData.get(normalizedPN) ||
                          vendorData.get(newPartNumber.trim()) ||
                          vendorData.get(newPartNumber);
                        if (vendor && allVendors.includes(normalizeVendorKey(vendor))) {
                          updateVendorFromDropdown(item.rowIndex, normalizeVendorKey(vendor));
                        }
                      }
                    }}
                    disabled={!canEditLineItems || isSaving}
                    className="w-full px-2 py-1.5 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 dark:disabled:bg-slate-800/50 disabled:cursor-not-allowed placeholder:text-slate-500 dark:placeholder:text-slate-500"
                    placeholder="Part Number"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-900 dark:text-slate-300 mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={getCurrentFieldValue(item, "description") || ""}
                    onChange={(e) =>
                      updateField(item.rowIndex, "description", e.target.value)
                    }
                    disabled={!canEditLineItems || isSaving}
                    className="w-full px-2 py-1.5 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 dark:disabled:bg-slate-800/50 placeholder:text-slate-500 dark:placeholder:text-slate-500"
                    placeholder="Description"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-900 dark:text-slate-300 mb-1">
                      UOM
                    </label>
                    <input
                      type="text"
                      value={getCurrentFieldValue(item, "uom") || ""}
                      onChange={(e) =>
                        updateField(item.rowIndex, "uom", e.target.value.slice(0, 3))
                      }
                      disabled={!canEditLineItems || isSaving}
                      maxLength={3}
                      className="overview-uom-input w-full px-2 py-1.5 bg-slate-700/50 border border-slate-600/50 text-white rounded text-sm text-center font-semibold uppercase tracking-tight focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-slate-800/50 placeholder:text-slate-500"
                      placeholder="UOM"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-900 dark:text-slate-300 mb-1">
                      Needed
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={getNeededDisplayForItem(item)}
                      onChange={(e) =>
                        updateField(
                          item.rowIndex,
                          "quantityNeeded",
                          parseInt(e.target.value) || 0,
                        )
                      }
                      disabled={
                        !canEditLineItems ||
                        isSaving ||
                        isNeededLockedToVendorOrder(item)
                      }
                      title={getNeededDisplayTitle(item)}
                      className="overview-qty-input w-full px-2 py-1.5 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded text-sm text-center font-semibold tabular-nums focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 dark:disabled:bg-slate-800/50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-900 dark:text-slate-300 mb-1">
                      FAB
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={clampFab(
                        getCurrentFieldValue(item, "quantityFab"),
                        getCurrentFieldValue(item, "quantityNeeded"),
                      )}
                      onChange={(e) =>
                        updateField(
                          item.rowIndex,
                          "quantityFab",
                          parseInt(e.target.value, 10) || 0,
                        )
                      }
                      onBlur={() => {
                        const maxF = getMaxFabAllowedForItem(item);
                        const cur = clampFab(
                          getCurrentFieldValue(item, "quantityFab"),
                          getCurrentFieldValue(item, "quantityNeeded"),
                        );
                        if (cur > maxF) {
                          updateField(item.rowIndex, "quantityFab", maxF);
                        }
                      }}
                      disabled={
                        !canEditLineItems ||
                        isSaving ||
                        (!canIncreaseFab(item) &&
                          clampFab(
                            getCurrentFieldValue(item, "quantityFab"),
                            getCurrentFieldValue(item, "quantityNeeded"),
                          ) === 0)
                      }
                      className="overview-qty-input w-full px-2 py-1.5 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded text-sm text-center font-semibold tabular-nums focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 dark:disabled:bg-slate-800/50"
                    />
                  </div>
                </div>
                <div
                  className={`text-xs font-medium ${hasRemaining ? "text-red-400" : "text-green-400"}`}
                >
                  Remaining: {remaining}
                </div>
              </div>

              {/* Quantity Input - Split into Shop and Vendor */}
              <div className="mb-3">
                <label className="block text-xs font-semibold text-slate-900 dark:text-slate-300 mb-1.5">
                  Shop
                </label>
                {(() => {
                  const available = getAvailableInventory(item);
                  const needed = item.quantityNeeded || 0;
                  const maxShopByDemand = getMaxShopPullForItem(item);
                  const hasInventoryError = inventoryErrors.has(
                    item.partNumber || "",
                  );
                  const inventoryStatus =
                    available >= needed
                      ? "green"
                      : available > 0
                        ? "yellow"
                        : "red";
                  const borderColor =
                    inventoryStatus === "green"
                      ? "border-green-500/50"
                      : inventoryStatus === "yellow"
                        ? "border-yellow-500/50"
                        : "border-red-500/50";
                  const inputBgColor =
                    inventoryStatus === "green"
                      ? "bg-white dark:bg-slate-700/50"
                      : inventoryStatus === "yellow"
                        ? "bg-yellow-50 dark:bg-yellow-900/20"
                        : "bg-red-50 dark:bg-red-900/20";
                  const originalShop = getOriginalPulledFromShop(item);
                  const currentShop = getPulledFromShop(item);
                  const maxAllowed = Math.min(
                    available + originalShop,
                    maxShopByDemand,
                  );
                  const shopPullBlocked = isShopPullBlocked(item);
                  const shopBlocked =
                    shopPullBlocked ||
                    (!canIncreaseShop(item) && currentShop === 0);
                  const shopInputBgColor = shopPullBlocked
                    ? "bg-gray-100 dark:bg-slate-800/50"
                    : inputBgColor;
                  const shopBorderColor = shopPullBlocked
                    ? "border-gray-300 dark:border-slate-600/50"
                    : borderColor;

                  return (
                    <>
                      {renderShopPullHint(item, remaining)}
                      <input
                        type="number"
                        min="0"
                        max={maxAllowed}
                        value={getPulledFromShop(item)}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          const newShop = parseInt(e.target.value) || 0;
                          applyShopAllocationChange(
                            item,
                            newShop,
                            originalShop,
                            maxAllowed,
                          );
                        }}
                        onBlur={(e) => {
                          const newShop = parseInt(e.target.value) || 0;
                          const available = getAvailableInventory(item);
                          const maxAllowedBlur = Math.min(
                            available + originalShop,
                            getMaxShopPullForItem(item),
                          );

                          if (newShop > originalShop && newShop > maxAllowedBlur) {
                            applyShopAllocationChange(
                              item,
                              newShop,
                              originalShop,
                              maxAllowedBlur,
                            );
                          }
                        }}
                        disabled={!canPullFromShop || isSaving || shopBlocked}
                        title={getShopBlockTitle(item, shopBlocked)}
                        className={`w-full px-3 py-2.5 ${shopInputBgColor} border ${shopBorderColor} text-slate-900 dark:text-white rounded-lg text-base font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 dark:disabled:bg-slate-800/50 disabled:text-slate-500 dark:disabled:text-slate-400 disabled:cursor-not-allowed`}
                      />
                      <p
                        className={`text-xs mt-1 ${
                          inventoryStatus === "green"
                            ? "text-green-400"
                            : inventoryStatus === "yellow"
                              ? "text-yellow-400"
                              : "text-red-400"
                        }`}
                      >
                        Available: {available}
                        {available < needed && available > 0 && (
                          <span className="ml-2">
                            ⚠️ Partial ({needed - available} short)
                          </span>
                        )}
                        {available === 0 && needed > 0 && (
                          <span className="ml-2">⚠️ Out of stock</span>
                        )}
                        {hasInventoryError && (
                          <span className="text-yellow-400 ml-2">
                            ⚠️ {inventoryErrors.get(item.partNumber || "")}
                          </span>
                        )}
                        {inventoryLoading && (
                          <span className="text-slate-600 dark:text-slate-400 ml-2">
                            (Loading...)
                          </span>
                        )}
                      </p>
                    </>
                  );
                })()}
              </div>
              {jobPreorderFeaturesEnabled ? (
                <div className="mb-3">
                  <label className="block text-xs font-semibold text-slate-900 dark:text-slate-300 mb-1.5">
                    Pre-Order pull
                  </label>
                  {renderPreorderPullControl(item, "mobile")}
                </div>
              ) : null}
              <div className="mb-3">
                <label className="block text-xs font-semibold text-slate-900 dark:text-slate-300 mb-1.5">
                  Vendor order
                </label>
                {renderVendorOrderControl(item, "mobile")}
              </div>

              {/* Supplier */}
              <div className="mb-3">
                <label className="block text-xs font-semibold text-slate-900 dark:text-slate-300 mb-1.5">
                  Supplier
                </label>
                <select
                  value={getVendorDropdownValue(item)}
                  onChange={(e) =>
                    updateVendorFromDropdown(item.rowIndex, e.target.value)
                  }
                  disabled={!canEditLineItems || isSaving}
                  className="w-full px-3 py-2.5 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded-lg text-base font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 dark:disabled:bg-slate-800/50"
                >
                  <option value="">—</option>
                  {allVendors.map((vendor) => (
                    <option key={vendor} value={vendor}>
                      {formatVendorDisplay(vendor)}
                    </option>
                  ))}
                  <option value="Other">Other</option>
                </select>
                {/* Show custom vendor input when "Other" is selected */}
                {getVendorDropdownValue(item) === "Other" && (
                  <input
                    type="text"
                    value={
                      customVendors.get(item.rowIndex) ||
                      getCurrentVendor(item) ||
                      ""
                    }
                    onChange={(e) =>
                      updateCustomVendor(item.rowIndex, e.target.value)
                    }
                    disabled={!canEditLineItems || isSaving}
                    placeholder="Enter vendor name"
                    className="w-full mt-2 px-3 py-2.5 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded-lg text-base font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 dark:disabled:bg-slate-800/50 placeholder:text-slate-500 dark:placeholder:text-slate-500"
                  />
                )}
              </div>

              {/* Status */}
              <div className="flex flex-col gap-2 pt-3 border-t border-gray-200 dark:border-slate-600/50">
                <div className="text-center">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-300">
                    Status:{" "}
                    <span className="text-slate-700 dark:text-slate-200">
                      {(() => {
                        const statuses: string[] = [];
                        const quantityPulledFromShop = getPulledFromShop(item);
                        const jobPoQty = getPulledFromPreorder(item);
                        const itemIsOrdered = isOrdered(item);
                        const itemIsReceived = isReceived(item);
                        const itemIsSupplierDeliveryPending =
                          isSupplierDeliveryPending(item);
                        const itemIsPickupPending = isPickupPending(item);

                        if (quantityPulledFromShop > 0) statuses.push("Pulled");
                        if (jobPoQty > 0) statuses.push("PO");
                        if (itemIsReceived) {
                          statuses.push("Received");
                        } else if (itemIsOrdered) {
                          statuses.push(
                            itemIsSupplierDeliveryPending
                              ? "Delivery"
                              : itemIsPickupPending
                                ? "Pickup"
                                : "Ordered",
                          );
                        }

                        if (statuses.length > 0) return statuses.join(", ");
                        const needed = toNonNegativeInt(
                          getCurrentFieldValue(item, "quantityNeeded") ??
                            item.quantityNeeded,
                        );
                        const fab = clampFab(
                          getCurrentFieldValue(item, "quantityFab") ??
                            item.quantityFab,
                          needed,
                        );
                        if (needed > 0 && fab >= needed) return "FAB";
                        return "—";
                      })()}
                    </span>
                  </div>
                </div>
                {canDeleteParts && (
                  <button
                    onClick={() => openDeleteConfirmModal(item)}
                    disabled={isSaving || deletingPartNumber === item.partNumber}
                    className="w-full px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg text-base font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                    Delete Part
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop / landscape tablet table — fits container width (no horizontal scroll) */}
      <div className="hidden lg:flex flex-1 min-h-0 flex-col bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 rounded-xl overflow-hidden shadow-xl min-w-0">
        <div
          ref={headerScrollRef}
          className="overview-table-header-sync flex-shrink-0 overflow-x-hidden overflow-y-hidden bg-blue-500 dark:bg-blue-600 shadow-[0_2px_4px_rgba(0,0,0,0.12)]"
        >
          <table className="w-full table-fixed border-separate border-spacing-0">
            {overviewDesktopColGroup}
            <thead className="text-white">
              <tr>
                {canReorderRows ? (
                  <th
                    className={`${stickyHeaderCellClass} ${overviewHeaderCell} text-center`}
                  >
                    <span className="sr-only">Reorder</span>
                  </th>
                ) : null}
                <th className={`${stickyHeaderCellClass} ${overviewHeaderCell} text-left`}>
                  <span className="xl:hidden">Part #</span>
                  <span className="hidden xl:inline">Part Number</span>
                </th>
                <th className={`${stickyHeaderCellClass} ${overviewHeaderCell} text-left max-w-0`}>
                  Description
                </th>
                <th className={`${stickyHeaderCellClass} ${overviewHeaderCell} text-center hidden xl:table-cell`}>
                  UOM
                </th>
                <th className={`${stickyHeaderCellClass} ${overviewHeaderCell} text-center`}>
                  <span className="xl:hidden">Need</span>
                  <span className="hidden xl:inline">Needed</span>
                </th>
                <th className={`${stickyHeaderCellClass} ${overviewHeaderCell} text-center`}>
                  FAB
                </th>
                <th className={`${stickyHeaderCellClass} ${overviewHeaderCell} text-center`}>
                  Shop
                </th>
                {jobPreorderFeaturesEnabled ? (
                  <th
                    className={`${stickyHeaderCellClass} ${overviewHeaderCell} text-center`}
                    title="Pull received pre-order stock into this list line"
                  >
                    <span className="xl:hidden">Pre</span>
                    <span className="hidden xl:inline">Pre-Order pull</span>
                  </th>
                ) : null}
                <th className={`${stickyHeaderCellClass} ${overviewHeaderCell} text-center`}>
                  <span className="xl:hidden">V.Order</span>
                  <span className="hidden xl:inline">Vendor order</span>
                </th>
                <th className={`${stickyHeaderCellClass} ${overviewHeaderCell} text-center whitespace-nowrap`}>
                  <span className="2xl:hidden">Rem</span>
                  <span className="hidden 2xl:inline">Remaining</span>
                </th>
                <th className={`${stickyHeaderCellClass} ${overviewHeaderCell} text-center whitespace-nowrap hidden xl:table-cell`}>
                  <span className="2xl:hidden">Stat</span>
                  <span className="hidden 2xl:inline">Status</span>
                </th>
                <th className={`${stickyHeaderCellClass} ${overviewHeaderCell} text-left`}>
                  <span className="xl:hidden">Supp</span>
                  <span className="hidden xl:inline">Supplier</span>
                </th>
                {canDeleteParts ? (
                  <th
                    className={`${stickyHeaderCellClass} ${overviewHeaderCell} text-center`}
                  >
                    <span className="sr-only">Delete</span>
                  </th>
                ) : null}
              </tr>
            </thead>
          </table>
        </div>
        <div
          ref={desktopScrollRef}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
          onScroll={syncHeaderHorizontalScroll}
        >
          <table className="w-full table-fixed border-separate border-spacing-0">
            {overviewDesktopColGroup}
            <tbody className="divide-y divide-slate-700/50">
                  {displayedItems.map((item) => {
                const remaining = getRemaining(item);
                const pulled = isPulled(item);
                const ordered = isOrdered(item);
                const received = isReceived(item);
                const hasRemaining = remaining > 0;

                return (
                  <StaticTableRow
                    key={item.rowIndex}
                    rowId={item.rowIndex}
                    rowClassName={`hover:bg-gray-100 dark:hover:bg-slate-700/30 transition-all ${
                      hasRemaining ? "bg-red-50 dark:bg-red-900/20" : "bg-white dark:bg-slate-800/40"
                    } ${draggingRowIndex === item.rowIndex ? "opacity-60" : ""}`}
                    onDragOver={
                      canReorderRows
                        ? (e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                          }
                        : undefined
                    }
                    onDrop={
                      canReorderRows
                        ? (e) => {
                            e.preventDefault();
                            const raw = e.dataTransfer.getData(JOB_ROW_DND_MIME);
                            const source = parseInt(raw, 10);
                            if (Number.isNaN(source)) return;
                            applyRowReorderByRowIndex(source, item.rowIndex);
                          }
                        : undefined
                    }
                  >
                    {canReorderRows ? (
                      <td className="px-0 py-1 align-middle">
                        <div
                          role="button"
                          tabIndex={0}
                          draggable={!isSaving}
                          title="Drag to reorder rows (then Save Changes)"
                          aria-label={`Reorder part row ${item.partNumber ?? item.rowIndex}`}
                          onDragStart={(e) => {
                            e.dataTransfer.setData(
                              JOB_ROW_DND_MIME,
                              String(item.rowIndex),
                            );
                            e.dataTransfer.effectAllowed = "move";
                            setDraggingRowIndex(item.rowIndex);
                          }}
                          onDragEnd={() => setDraggingRowIndex(null)}
                          className={`mx-auto flex h-8 w-7 cursor-grab touch-none items-center justify-center rounded text-slate-500 hover:bg-slate-200/80 active:cursor-grabbing dark:text-slate-400 dark:hover:bg-slate-600/50 ${isSaving ? "pointer-events-none opacity-40" : ""}`}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            aria-hidden
                          >
                            <path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm6 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm6 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm6 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm6 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm6 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm6 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
                          </svg>
                        </div>
                      </td>
                    ) : null}
                    <td className="px-1 py-1 xl:px-3 xl:py-2">
                      <input
                        type="text"
                        value={getCurrentFieldValue(item, "partNumber") || ""}
                        onChange={(e) => {
                          updateField(
                            item.rowIndex,
                            "partNumber",
                            e.target.value,
                          );
                          // Auto-update vendor when part number changes (if vendor data is available)
                          // But only if user hasn't explicitly selected a vendor
                          const newPartNumber = e.target.value;
                          if (
                            newPartNumber &&
                            vendorData.size > 0 &&
                            !manualVendorSelections.has(item.rowIndex)
                          ) {
                            const normalizedPN = newPartNumber
                              .replace(/[\s\t\r\n]+/g, "")
                              .toUpperCase()
                              .trim();
                            const vendor =
                              vendorData.get(normalizedPN) ||
                              vendorData.get(newPartNumber.trim()) ||
                              vendorData.get(newPartNumber);
                            if (vendor && allVendors.includes(normalizeVendorKey(vendor))) {
                              updateVendorFromDropdown(item.rowIndex, normalizeVendorKey(vendor));
                            }
                          }
                        }}
                        disabled={!canEditLineItems || isSaving}
                        className="w-full px-1 py-0.5 xl:px-2 xl:py-1 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded text-[10px] xl:text-sm font-mono focus:ring-1 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 dark:disabled:bg-slate-800/50 placeholder:text-slate-500 dark:placeholder:text-slate-500"
                        placeholder="Part #"
                      />
                    </td>
                    <td className="px-1 py-1 xl:px-3 xl:py-2 max-w-0">
                      <input
                        type="text"
                        value={getCurrentFieldValue(item, "description") || ""}
                        onChange={(e) =>
                          updateField(
                            item.rowIndex,
                            "description",
                            e.target.value,
                          )
                        }
                        disabled={!canEditLineItems || isSaving}
                        className="w-full truncate px-1 py-0.5 xl:px-2 xl:py-1 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded text-[10px] xl:text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 dark:disabled:bg-slate-800/50 placeholder:text-slate-500 dark:placeholder:text-slate-500"
                        placeholder="Description"
                      />
                    </td>
                    <td className="px-0.5 py-1 xl:px-1 xl:py-2 text-center hidden xl:table-cell">
                      <input
                        type="text"
                        value={getCurrentFieldValue(item, "uom") || ""}
                        onChange={(e) =>
                          updateField(item.rowIndex, "uom", e.target.value.slice(0, 3))
                        }
                        disabled={!canEditLineItems || isSaving}
                        maxLength={3}
                        className={overviewUomInputClass}
                        placeholder="—"
                      />
                    </td>
                    <td className="px-1 py-1 xl:px-3 xl:py-2 text-center">
                      <input
                        type="number"
                        min="0"
                        value={getNeededDisplayForItem(item)}
                        onChange={(e) =>
                          updateField(
                            item.rowIndex,
                            "quantityNeeded",
                            parseInt(e.target.value) || 0,
                          )
                        }
                        disabled={
                          !canEditLineItems ||
                          isSaving ||
                          isNeededLockedToVendorOrder(item)
                        }
                        title={getNeededDisplayTitle(item)}
                        className={overviewQtyInputClass}
                      />
                    </td>
                    <td className="px-1 py-1 xl:px-3 xl:py-2 text-center">
                      <input
                        type="number"
                        min="0"
                        value={clampFab(
                          getCurrentFieldValue(item, "quantityFab"),
                          getCurrentFieldValue(item, "quantityNeeded"),
                        )}
                        onChange={(e) =>
                          updateField(
                            item.rowIndex,
                            "quantityFab",
                            parseInt(e.target.value, 10) || 0,
                          )
                        }
                        onBlur={() => {
                          const maxF = getMaxFabAllowedForItem(item);
                          const cur = clampFab(
                            getCurrentFieldValue(item, "quantityFab"),
                            getCurrentFieldValue(item, "quantityNeeded"),
                          );
                          if (cur > maxF) {
                            updateField(item.rowIndex, "quantityFab", maxF);
                          }
                        }}
                        disabled={
                          !canEditLineItems ||
                          isSaving ||
                          (!canIncreaseFab(item) &&
                            clampFab(
                              getCurrentFieldValue(item, "quantityFab"),
                              getCurrentFieldValue(item, "quantityNeeded"),
                            ) === 0)
                        }
                        className={overviewQtyInputClass}
                      />
                    </td>
                    <td className="px-1 py-1 xl:px-3 xl:py-2 text-center">
                      {(() => {
                        const available = getAvailableInventory(item);
                        const needed = item.quantityNeeded || 0;
                        const maxShopByDemand = getMaxShopPullForItem(item);
                        const hasInventoryError = inventoryErrors.has(
                          item.partNumber || "",
                        );
                        const inventoryStatus =
                          available >= needed
                            ? "green"
                            : available > 0
                              ? "yellow"
                              : "red";
                        const borderColor =
                          inventoryStatus === "green"
                            ? "border-green-500 dark:border-green-500/50"
                            : inventoryStatus === "yellow"
                              ? "border-yellow-500 dark:border-yellow-500/50"
                              : "border-red-500 dark:border-red-500/50";
                        const inputBgColor =
                          inventoryStatus === "green"
                            ? "bg-green-50 dark:bg-slate-700/50"
                            : inventoryStatus === "yellow"
                              ? "bg-yellow-50 dark:bg-yellow-900/20"
                              : "bg-red-50 dark:bg-red-900/20";
                        const textColor =
                          inventoryStatus === "green"
                            ? "text-green-700 dark:text-white"
                            : inventoryStatus === "yellow"
                              ? "text-yellow-700 dark:text-white"
                              : "text-red-700 dark:text-white";
                        const originalShop =
                          getOriginalPulledFromShop(item);
                        const currentShop = getPulledFromShop(item);
                        const maxAllowed = Math.min(
                          available + originalShop,
                          maxShopByDemand,
                        );
                        const shopPullBlocked = isShopPullBlocked(item);
                        const shopBlocked =
                          shopPullBlocked ||
                          (!canIncreaseShop(item) && currentShop === 0);
                        const shopInputBgColor = shopPullBlocked
                          ? "bg-gray-100 dark:bg-slate-800/50"
                          : inputBgColor;
                        const shopBorderColor = shopPullBlocked
                          ? "border-gray-300 dark:border-slate-600/50"
                          : borderColor;
                        const shopTextColor = shopPullBlocked
                          ? "text-slate-500 dark:text-slate-400"
                          : textColor;

                        return (
                          <div className="flex flex-col items-center justify-center gap-0.5 min-w-0">
                            {renderShopPullHint(item, remaining)}
                            <input
                              type="number"
                              min="0"
                              max={maxAllowed}
                              value={getPulledFromShop(item)}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => {
                                const newShop = parseInt(e.target.value) || 0;
                                const available = getAvailableInventory(item);
                                const maxShopByDemandCur =
                                  getMaxShopPullForItem(item);
                                const maxAllowedCur = Math.min(
                                  available + originalShop,
                                  maxShopByDemandCur,
                                );
                                applyShopAllocationChange(
                                  item,
                                  newShop,
                                  originalShop,
                                  maxAllowedCur,
                                );
                              }}
                              onBlur={(e) => {
                                const newShop = parseInt(e.target.value) || 0;
                                const available = getAvailableInventory(item);
                                const maxAllowedBlur = Math.min(
                                  available + originalShop,
                                  getMaxShopPullForItem(item),
                                );

                                if (
                                  newShop > originalShop &&
                                  newShop > maxAllowedBlur
                                ) {
                                  applyShopAllocationChange(
                                    item,
                                    newShop,
                                    originalShop,
                                    maxAllowedBlur,
                                  );
                                }
                              }}
                              disabled={!canPullFromShop || isSaving || shopBlocked}
                              title={getShopBlockTitle(item, shopBlocked)}
                              className={`overview-qty-input w-full min-w-0 max-w-[4.75rem] mx-auto px-1.5 py-0.5 lg:px-2 lg:py-1 ${shopInputBgColor} border ${shopBorderColor} ${shopTextColor} rounded text-[10px] xl:text-sm text-center font-semibold tabular-nums leading-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 disabled:bg-slate-800/50 disabled:text-slate-500 dark:disabled:text-slate-400 disabled:cursor-not-allowed`}
                            />
                            <span
                              className={`shrink-0 text-[8px] xl:text-[10px] font-medium leading-tight whitespace-nowrap ${
                                inventoryStatus === "green"
                                  ? "text-green-700 dark:text-green-400"
                                  : inventoryStatus === "yellow"
                                    ? "text-yellow-700 dark:text-yellow-400"
                                    : "text-red-700 dark:text-red-400"
                              }`}
                              title={`Available inventory: ${available}`}
                            >
                              Av:{available}
                              {available < needed && available > 0 && (
                                <span className="ml-0.5">⚠️</span>
                              )}
                              {available === 0 && needed > 0 && (
                                <span className="ml-0.5">⚠️</span>
                              )}
                              {hasInventoryError && (
                                <span className="text-yellow-400 ml-0.5">⚠️</span>
                              )}
                              {inventoryLoading && (
                                <span className="text-slate-400 ml-0.5">...</span>
                              )}
                            </span>
                          </div>
                        );
                      })()}
                    </td>
                    {jobPreorderFeaturesEnabled ? (
                      <td className="px-1 py-1 xl:px-3 xl:py-2 text-center">
                        {renderPreorderPullControl(item, "desktop")}
                      </td>
                    ) : null}
                    <td className="px-1 py-1 xl:px-3 xl:py-2 text-center align-middle">
                      {renderVendorOrderControl(item, "desktop")}
                    </td>
                    <td
                      className={`px-1 py-1 xl:px-3 xl:py-2 text-[10px] xl:text-sm text-center font-semibold tabular-nums whitespace-nowrap ${
                        hasRemaining ? "text-red-400" : "text-green-400"
                      }`}
                    >
                      {remaining}
                    </td>
                    <td className="px-1 py-1 xl:px-3 xl:py-2 text-center hidden xl:table-cell">
                      <div className="text-[10px] xl:text-sm text-slate-900 dark:text-slate-300 whitespace-nowrap">
                        {(() => {
                          const statuses: string[] = [];
                          const quantityPulledFromShop = getPulledFromShop(item);
                          const jobPoQty = getPulledFromPreorder(item);
                          const itemIsOrdered = isOrdered(item);
                          const itemIsReceived = isReceived(item);
                          const itemIsSupplierDeliveryPending =
                            isSupplierDeliveryPending(item);
                          const itemIsPickupPending = isPickupPending(item);

                          if (quantityPulledFromShop > 0) statuses.push("Pulled");
                          if (jobPoQty > 0) statuses.push("PO");
                          if (itemIsReceived) {
                            statuses.push("Received");
                          } else if (itemIsOrdered) {
                            statuses.push(
                              itemIsSupplierDeliveryPending
                                ? "Delivery"
                                : itemIsPickupPending
                                  ? "Pickup"
                                  : "Ordered",
                            );
                          }

                          if (statuses.length > 0)
                            return statuses.join(", ");
                          const needed = toNonNegativeInt(
                            getCurrentFieldValue(item, "quantityNeeded") ??
                              item.quantityNeeded,
                          );
                          const fab = clampFab(
                            getCurrentFieldValue(item, "quantityFab") ??
                              item.quantityFab,
                            needed,
                          );
                          if (needed > 0 && fab >= needed) return "FAB";
                          return "—";
                        })()}
                      </div>
                    </td>
                    <td className="px-1 py-1 xl:px-3 xl:py-2">
                      <div className="flex flex-col items-stretch gap-0.5 xl:gap-1 min-w-0">
                        <select
                          value={getVendorDropdownValue(item)}
                          onChange={(e) =>
                            updateVendorFromDropdown(
                              item.rowIndex,
                              e.target.value,
                            )
                          }
                          disabled={!canEditLineItems || isSaving}
                          className="w-full min-w-0 px-1 py-0.5 xl:px-2 xl:py-1 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded text-[10px] xl:text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 dark:disabled:bg-slate-800/50"
                        >
                          <option value="">—</option>
                          {allVendors.map((vendor) => (
                            <option key={vendor} value={vendor}>
                              {formatVendorDisplay(vendor)}
                            </option>
                          ))}
                          <option value="Other">Other</option>
                        </select>
                        {getVendorDropdownValue(item) === "Other" && (
                          <input
                            type="text"
                            value={
                              customVendors.get(item.rowIndex) ||
                              getCurrentVendor(item) ||
                              ""
                            }
                            onChange={(e) =>
                              updateCustomVendor(item.rowIndex, e.target.value)
                            }
                            disabled={!canEditLineItems || isSaving}
                            placeholder="Vendor name"
                            className="w-full min-w-0 px-1 py-0.5 xl:px-2 xl:py-1 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded text-[10px] xl:text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 dark:disabled:bg-slate-800/50 placeholder:text-slate-500 dark:placeholder:text-slate-500"
                          />
                        )}
                      </div>
                    </td>
                    {canDeleteParts ? (
                      <td className="px-0.5 py-1 xl:px-1 xl:py-2 text-center align-middle">
                        <button
                          type="button"
                          onClick={() => openDeleteConfirmModal(item)}
                          disabled={
                            isSaving || deletingPartNumber === item.partNumber
                          }
                          title="Delete this part"
                          aria-label={`Delete part ${item.partNumber ?? ""}`}
                          className="mx-auto inline-flex h-7 w-7 xl:h-8 xl:w-8 items-center justify-center rounded border border-red-500/40 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-500/50 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <svg
                            className="w-3.5 h-3.5 xl:w-4 xl:h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            aria-hidden
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </td>
                    ) : null}
                  </StaticTableRow>
                );
              })}
                </tbody>
              </table>
        </div>
      </div>

      {allocationNotice && (
        <div
          role="status"
          className="flex-shrink-0 z-40 mx-4 mt-3 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <span className="flex-1">{allocationNotice}</span>
          <button
            type="button"
            onClick={() => setAllocationNotice(null)}
            className="shrink-0 rounded px-2 py-0.5 text-xs font-semibold text-amber-900 hover:bg-amber-200/60 dark:text-amber-200 dark:hover:bg-amber-800/60"
            aria-label="Dismiss allocation notice"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Save Button - pinned below the scrollable table */}
      <div className="flex-shrink-0 z-40 w-full bg-white dark:bg-slate-900/95 border-t border-gray-200 dark:border-slate-700/50 py-3 px-4 shadow-[0_-4px_20px_rgba(0,0,0,0.1)] dark:shadow-[0_-4px_20px_rgba(0,0,0,0.3)] flex justify-center">
        {!canEdit ? (
          <div className="w-full px-8 py-4 bg-gray-400 dark:bg-slate-600 text-white rounded-xl font-bold text-base text-center">
            🔒 Read-Only Mode - Contact admin for edit access
          </div>
        ) : (
          <button
            onClick={() => handleSave()}
            disabled={!hasChanges || isSaving}
            className="w-full px-8 py-4 bg-blue-500 text-white rounded-xl font-bold text-base hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-500/20"
          >
            {isSaving
              ? "Saving..."
              : hasChanges
                ? `Save Changes (${edits.size})`
                : "No Changes"}
          </button>
        )}
      </div>

      {/* Order All Confirmation Modal */}
      {showOrderAllModal && orderAllSummary ? (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-screen items-center justify-center px-4 py-8 sm:px-6">
            <div
              className="fixed inset-0 transition-opacity bg-black/50 backdrop-blur-sm"
              onClick={() => {
                if (!isSaving) {
                  setShowOrderAllModal(false);
                  setOrderAllSummary(null);
                  orderAllPendingEditsRef.current = null;
                  orderAllRowIndexesRef.current = [];
                }
              }}
            />

            <div className="relative z-10 w-full max-w-lg bg-white dark:bg-slate-800/90 border border-blue-200 dark:border-blue-500/50 rounded-2xl text-left overflow-hidden shadow-xl backdrop-blur-sm">
              <div className="bg-gray-50 dark:bg-slate-800/60 px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="flex items-start mb-4">
                  <div className="flex-shrink-0">
                    <svg
                      className="h-6 w-6 text-blue-600 dark:text-blue-400"
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
                  <div className="ml-3 flex-1">
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                      Order all remaining?
                    </h3>
                    <p className="text-sm text-slate-700 dark:text-slate-300">
                      Mark{" "}
                      <span className="font-semibold text-blue-600 dark:text-blue-400">
                        {orderAllSummary.eligibleCount}{" "}
                        {orderAllSummary.eligibleCount === 1 ? "part" : "parts"}
                      </span>{" "}
                      as ordered for a total of{" "}
                      <span className="font-semibold text-blue-600 dark:text-blue-400">
                        {orderAllSummary.totalQty} units
                      </span>{" "}
                      on this list. Lines already ordered, fully covered, or
                      missing a part number will be skipped
                      {orderAllSummary.skippedCount > 0
                        ? ` (${orderAllSummary.skippedCount} skipped)`
                        : ""}
                      .
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-slate-800/40 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse gap-3 border-t border-gray-200 dark:border-slate-700/50">
                <button
                  type="button"
                  onClick={() => void confirmOrderAll()}
                  disabled={isSaving}
                  className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? "Ordering..." : "Order All"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowOrderAllModal(false);
                    setOrderAllSummary(null);
                    orderAllPendingEditsRef.current = null;
                    orderAllRowIndexesRef.current = [];
                  }}
                  disabled={isSaving}
                  className="mt-3 sm:mt-0 w-full sm:w-auto px-6 py-2.5 bg-gray-200 dark:bg-slate-700/50 text-slate-900 dark:text-white rounded-xl font-semibold text-sm hover:bg-gray-300 dark:hover:bg-slate-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Order Quantity Modal */}
      {showOrderModal && orderModalItem && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-screen items-center justify-center px-4 py-8 sm:px-6">
            {/* Backdrop */}
            <div
              className="fixed inset-0 transition-opacity bg-black/50 backdrop-blur-sm"
              onClick={() => {
                setShowOrderModal(false);
                setOrderModalItem(null);
              }}
            />

            {/* Modal */}
            <div className="relative z-10 w-full max-w-lg bg-white dark:bg-slate-800/90 border border-blue-200 dark:border-blue-500/50 rounded-2xl text-left overflow-hidden shadow-xl backdrop-blur-sm">
              <div className="bg-gray-50 dark:bg-slate-800/60 px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="flex items-start mb-4">
                  <div className="flex-shrink-0">
                    <svg
                      className="h-6 w-6 text-blue-600 dark:text-blue-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
                      />
                    </svg>
                  </div>
                  <div className="ml-3 flex-1">
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                      Order Part
                    </h3>
                    <div className="space-y-4">
                      {/* Part Information */}
                      <div className="bg-slate-100 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-700/50 p-4">
                        <div className="space-y-2 text-sm">
                          <div>
                            <span className="text-slate-600 dark:text-slate-400">Part Number:</span>{" "}
                            <span className="font-mono font-semibold text-slate-900 dark:text-white">
                              {orderModalItem.partNumber || "—"}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-600 dark:text-slate-400">Description:</span>{" "}
                            <span className="text-slate-800 dark:text-slate-300">
                              {orderModalItem.description || "—"}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-600 dark:text-slate-400">
                              Remaining Quantity:
                            </span>{" "}
                            <span className="font-semibold text-blue-600 dark:text-blue-400">
                              {getRemaining(orderModalItem)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Quantity Input */}
                      <div>
                        <label className="block text-sm font-semibold text-slate-800 dark:text-slate-300 mb-2">
                          Quantity to Order{" "}
                          <span className="text-red-600 dark:text-red-400">*</span>
                        </label>
                        <input
                          type="number"
                          min="1"
                          max={getRemaining(orderModalItem)}
                          value={orderQuantity}
                          onChange={(e) => {
                            const value = parseInt(e.target.value) || 0;
                            const max = getRemaining(orderModalItem);
                            setOrderQuantity(Math.min(Math.max(1, value), max));
                          }}
                          onBlur={(e) => {
                            const value = parseInt(e.target.value) || 0;
                            const max = getRemaining(orderModalItem);
                            if (value < 1) {
                              setOrderQuantity(1);
                            } else if (value > max) {
                              setOrderQuantity(max);
                            }
                          }}
                          className="w-full px-4 py-3 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded-xl text-lg font-semibold focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all placeholder:text-slate-500 dark:placeholder:text-slate-400"
                          placeholder="Enter quantity"
                          autoFocus
                        />
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                          Maximum: {getRemaining(orderModalItem)} (remaining
                          quantity)
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-slate-800/40 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse gap-3 border-t border-gray-200 dark:border-slate-700/50">
                <button
                  type="button"
                  onClick={() => {
                    const quantity = orderQuantity;
                    if (
                      quantity > 0 &&
                      quantity <= getRemaining(orderModalItem)
                    ) {
                      handleConfirmOrder(quantity);
                    }
                  }}
                  disabled={
                    isSaving ||
                    orderQuantity <= 0 ||
                    orderQuantity > getRemaining(orderModalItem)
                  }
                  className="w-full sm:w-auto px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-xl font-semibold transition-all shadow-lg shadow-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? "Ordering..." : "Confirm Order"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowOrderModal(false);
                    setOrderModalItem(null);
                  }}
                  disabled={isSaving}
                  className="w-full sm:w-auto px-4 py-2 bg-gray-200 dark:bg-slate-700/50 text-slate-800 dark:text-slate-300 rounded-xl font-semibold hover:bg-gray-300 dark:hover:bg-slate-700/70 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Vendor Mismatch Warning Modal */}
      {showVendorWarning && vendorMismatches.length > 0 && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-screen items-center justify-center px-4 py-8 sm:px-6">
            {/* Backdrop */}
            <div
              className="fixed inset-0 transition-opacity bg-black/50 backdrop-blur-sm"
              onClick={() => setShowVendorWarning(false)}
            />

            {/* Modal */}
            <div className="relative z-10 w-full max-w-2xl bg-white dark:bg-slate-800/90 border border-amber-200 dark:border-yellow-500/50 rounded-2xl text-left overflow-hidden shadow-xl backdrop-blur-sm">
              <div className="bg-amber-50/80 dark:bg-slate-800/60 px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="flex items-start mb-4">
                  <div className="flex-shrink-0">
                    <svg
                      className="h-6 w-6 text-amber-600 dark:text-yellow-400"
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
                    <h3 className="text-xl font-bold text-amber-800 dark:text-yellow-400 mb-2">
                      Vendor Mismatch Detected
                    </h3>
                    <p className="text-sm text-slate-700 dark:text-slate-300 mb-4">
                      You have set vendors that differ from the database values
                      for {vendorMismatches.length}{" "}
                      {vendorMismatches.length === 1 ? "item" : "items"}. Please
                      review the changes below:
                    </p>

                    {/* List of mismatched items */}
                    <div className="bg-slate-100 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-700/50 max-h-64 overflow-y-auto mb-4">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-200 dark:bg-slate-700/50 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-bold text-slate-700 dark:text-slate-300 uppercase">
                              Part Number
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-bold text-slate-700 dark:text-slate-300 uppercase">
                              Description
                            </th>
                            <th className="px-3 py-2 text-right text-xs font-bold text-slate-700 dark:text-slate-300 uppercase">
                              Database Vendor
                            </th>
                            <th className="px-3 py-2 text-right text-xs font-bold text-amber-700 dark:text-yellow-400 uppercase">
                              Your Vendor
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                          {vendorMismatches.map((mismatch, idx) => (
                            <tr
                              key={idx}
                              className={
                                idx % 2 === 0
                                  ? "bg-white dark:bg-slate-800/30"
                                  : "bg-slate-50 dark:bg-slate-800/10"
                              }
                            >
                              <td className="px-3 py-2 text-xs font-mono font-semibold text-slate-900 dark:text-white">
                                {mismatch.partNumber}
                              </td>
                              <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400 max-w-xs truncate">
                                {mismatch.description || "—"}
                              </td>
                              <td className="px-3 py-2 text-xs text-right text-slate-700 dark:text-slate-300">
                                {mismatch.databaseVendor}
                              </td>
                              <td className="px-3 py-2 text-xs text-right font-bold text-amber-700 dark:text-yellow-400">
                                {mismatch.userVendor}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <p className="text-xs text-slate-500 dark:text-slate-400 italic">
                      Click "Continue Anyway" to save with your vendor
                      selections, or "Cancel" to review and adjust the vendors.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-slate-800/40 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse gap-3 border-t border-gray-200 dark:border-slate-700/50">
                <button
                  type="button"
                  onClick={() => performSave()}
                  disabled={isSaving}
                  className="w-full sm:w-auto px-4 py-2 bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-white rounded-xl font-semibold transition-all shadow-lg shadow-yellow-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Continue Anyway
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowVendorWarning(false);
                    setVendorMismatches([]);
                  }}
                  disabled={isSaving}
                  className="w-full sm:w-auto px-4 py-2 bg-gray-200 dark:bg-slate-700/50 text-slate-800 dark:text-slate-300 rounded-xl font-semibold hover:bg-gray-300 dark:hover:bg-slate-700/70 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Part Confirmation Modal */}
      {showDeleteConfirmModal && partToDelete && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !deletingPartNumber) {
              setShowDeleteConfirmModal(false);
              setPartToDelete(null);
            }
          }}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full border border-gray-200 dark:border-slate-700/50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700/50">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                Delete Part
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-slate-700 dark:text-slate-300">
                Are you sure you want to delete this part?
              </p>
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-600/50 rounded-xl p-4 space-y-2">
                <div>
                  <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">Part Number:</span>
                  <span className="ml-2 text-sm font-bold text-slate-900 dark:text-white">{partToDelete.partNumber}</span>
                </div>
                {partToDelete.description && (
                  <div>
                    <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">Description:</span>
                    <span className="ml-2 text-sm text-slate-900 dark:text-white">{partToDelete.description}</span>
                  </div>
                )}
              </div>
              <p className="text-sm text-red-600 dark:text-red-400 font-semibold">
                ⚠️ This action cannot be undone.
              </p>
            </div>
            <div className="px-6 py-4 bg-gray-50 dark:bg-slate-800/50 border-t border-gray-200 dark:border-slate-700/50 flex gap-3 rounded-b-2xl">
              <button
                onClick={() => {
                  setShowDeleteConfirmModal(false);
                  setPartToDelete(null);
                }}
                disabled={!!deletingPartNumber}
                className="flex-1 px-4 py-2.5 bg-gray-200 dark:bg-slate-700/50 hover:bg-gray-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleDeletePart}
                disabled={!!deletingPartNumber}
                className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {deletingPartNumber === partToDelete.partNumber ? (
                  <>
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Deleting...
                  </>
                ) : (
                  "Delete Part"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Order Confirmation Modal */}
      {showCancelOrderModal && itemToCancelOrder && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !cancellingOrderRowIndex) {
              setShowCancelOrderModal(false);
              setItemToCancelOrder(null);
            }
          }}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full border border-gray-200 dark:border-slate-700/50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700/50">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                Cancel Order
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-slate-700 dark:text-slate-300">
                Are you sure you want to cancel this order? The part will return to un-ordered status.
              </p>
              <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-600/50 rounded-xl p-4 space-y-2">
                <div>
                  <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">Part Number:</span>
                  <span className="ml-2 text-sm font-bold text-slate-900 dark:text-white">{itemToCancelOrder.partNumber}</span>
                </div>
                {itemToCancelOrder.description && (
                  <div>
                    <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">Description:</span>
                    <span className="ml-2 text-sm text-slate-900 dark:text-white">{itemToCancelOrder.description}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 dark:bg-slate-800/50 border-t border-gray-200 dark:border-slate-700/50 flex gap-3 rounded-b-2xl">
              <button
                onClick={() => {
                  setShowCancelOrderModal(false);
                  setItemToCancelOrder(null);
                }}
                disabled={!!cancellingOrderRowIndex}
                className="flex-1 px-4 py-2.5 bg-gray-200 dark:bg-slate-700/50 hover:bg-gray-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmCancelOrder}
                disabled={!!cancellingOrderRowIndex || isSaving}
                className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {cancellingOrderRowIndex === itemToCancelOrder.rowIndex ? (
                  <>
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Cancelling...
                  </>
                ) : (
                  "Yes, Cancel Order"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
