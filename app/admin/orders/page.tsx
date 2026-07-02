'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Archive, Building2, Check, Eraser, Send, Trash2, Truck, Undo2, Warehouse, type LucideIcon } from 'lucide-react';
import DashboardSidebar from '@/components/DashboardSidebar';
import AccessDeniedOverlay from '@/components/AccessDeniedOverlay';
import VendorsHubModal from '@/components/vendors/VendorsHubModal';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { displaySupplierName, normalizeSupplierKey } from '@/lib/suppliers';
import type { UnifiedVendor } from '@/lib/vendorService';
import { formatDateInAppTimeZone } from '@/lib/timezone';
import { getRemainingQty } from '@/lib/quantityMath';
import { INVENTORY_REORDER_LIST_NUMBER } from '@/lib/inventoryReorder';
import { formatVendorDisplay, normalizeVendorKey } from '@/lib/vendorUtils';

interface OrderItem {
  jobNumber: string;
  listNumber?: string;
  jobName: string;
  partNumber: string;
  description: string | null;
  uom?: string | null;
  quantityOrdered: number | null;
  quantityNeeded: number;
  quantityFab: number;
  quantityPulled: number;
  quantityPreordered?: number;
  quantityReceivedFromOrder?: number;
  remainingToOrder?: number;
  vendor: string | null;
  isInPurchaseOrder?: boolean;
  canCancel?: boolean;
  cancelBlockReason?: string;
  reorderReason?: string;
  onHand?: number;
  minOnHand?: number;
  orderMinimum?: number;
}

interface PendingToReceiveItem extends OrderItem {
  quantityReceived?: number;
  pickupFromSupplier?: boolean;
  supplierDeliveryToJobsite?: boolean;
  isFullyReceived?: boolean;
  purchaseOrders: Array<{
    orderNumber: string;
    vendorPoLabel?: string | null;
    supplier?: string | null;
    recipientTo?: string[] | null;
    recipientCc?: string[] | null;
    sendStatus?: string;
    sentAt: Date;
    sentBy: string;
    orderId: string;
  }>;
}

interface PendingJob {
  jobNumber: string;
  jobName: string;
  area?: string | null;
  isInventoryReplenishment?: boolean;
  items: OrderItem[];
}

interface PendingToReceiveJob {
  jobNumber: string;
  jobName: string;
  area?: string | null;
  isInventoryReplenishment?: boolean;
  items: PendingToReceiveItem[];
}

interface HistoryOrderItem {
  jobNumber: string;
  listNumber?: string | null;
  jobName: string;
  area?: string | null;
  partNumber: string;
  description: string | null;
  quantityOrdered: number;
  vendor: string | null;
  cancelled?: boolean;
}

interface HistoryOrder {
  id: string;
  orderNumber: string;
  orderKind?: string;
  vendorPoLabel?: string | null;
  sentBy: string;
  sentAt: string;
  supplier?: string | null;
  sendStatus?: string;
  sendError?: string | null;
  recipientTo?: string[] | null;
  recipientCc?: string[] | null;
  batchId?: string | null;
  itemCount: number;
  jobCount: number;
  jobNumbers: string[];
  items: HistoryOrderItem[];
}

interface DeleteOrderReceivedSummary {
  hasReceivedParts: boolean;
  receivedPartLines: number;
  totalReceivedQuantity: number;
}

interface SendResult {
  supplier: string;
  orderNumber: string;
  vendorPoLabel?: string | null;
  recipientTo: string[];
  recipientCc: string[];
  itemCount: number;
  sendStatus: 'SENT' | 'FAILED';
  sendError: string | null;
  fallbackToPurchasing: boolean;
}

type TabType = 'pending-to-order' | 'pending-to-receive' | 'order-history';

type VendorOrderTabMeta = {
  label: string;
  emptyTitle: string;
  emptyDescription: string;
  icon: LucideIcon;
  iconAnimClass: string;
  stepBadgeClass: string;
  iconClass: string;
  countBadgeClass: string;
  activeTabClass: string;
  inactiveTabClass: string;
};

const VENDOR_ORDER_TABS: Record<TabType, VendorOrderTabMeta> = {
  'pending-to-order': {
    label: 'To Order',
    emptyTitle: 'Nothing waiting to order',
    emptyDescription: 'Mark items to order on a job, or they will appear here when inventory needs replenishment.',
    icon: Send,
    iconAnimClass: 'vendor-order-tab-icon--plane',
    stepBadgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
    iconClass: 'text-amber-600 dark:text-amber-400',
    countBadgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    activeTabClass:
      'bg-gradient-to-r from-amber-500 to-amber-600 border-amber-400 text-white shadow-lg shadow-amber-500/30',
    inactiveTabClass:
      'bg-slate-100 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600/80 text-slate-700 dark:text-slate-300 hover:bg-amber-50 dark:hover:bg-amber-950/20 hover:border-amber-300/60 dark:hover:border-amber-700/50',
  },
  'pending-to-receive': {
    label: 'On Order',
    emptyTitle: 'Nothing on order',
    emptyDescription: 'Sent purchase orders waiting to be picked up or received will show here.',
    icon: Truck,
    iconAnimClass: 'vendor-order-tab-icon--truck',
    stepBadgeClass: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200',
    iconClass: 'text-sky-600 dark:text-sky-400',
    countBadgeClass: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
    activeTabClass:
      'bg-gradient-to-r from-sky-500 to-blue-600 border-sky-400 text-white shadow-lg shadow-sky-500/30',
    inactiveTabClass:
      'bg-slate-100 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600/80 text-slate-700 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-sky-950/20 hover:border-sky-300/60 dark:hover:border-sky-700/50',
  },
  'order-history': {
    label: 'History',
    emptyTitle: 'No order history yet',
    emptyDescription: 'Purchase orders appear here after they are sent to vendors.',
    icon: Archive,
    iconAnimClass: 'vendor-order-tab-icon--archive',
    stepBadgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
    iconClass: 'text-emerald-600 dark:text-emerald-400',
    countBadgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
    activeTabClass:
      'bg-gradient-to-r from-emerald-500 to-emerald-600 border-emerald-400 text-white shadow-lg shadow-emerald-500/30',
    inactiveTabClass:
      'bg-slate-100 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600/80 text-slate-700 dark:text-slate-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 hover:border-emerald-300/60 dark:hover:border-emerald-700/50',
  },
};

const VENDOR_ORDER_CHECKBOX = 'vendor-order-checkbox vendor-order-checkbox--blue';
const VENDOR_ORDER_CHECKBOX_LG = `${VENDOR_ORDER_CHECKBOX} vendor-order-checkbox--lg`;
const VENDOR_ORDER_CHECKBOX_GREEN = 'vendor-order-checkbox vendor-order-checkbox--green';
const VENDOR_ORDER_CHECKBOX_GREEN_LG = `${VENDOR_ORDER_CHECKBOX_GREEN} vendor-order-checkbox--lg`;

function VendorOrderTabIcon({
  tab,
  isActive,
  meta,
}: {
  tab: TabType;
  isActive: boolean;
  meta: VendorOrderTabMeta;
}) {
  const Icon = meta.icon;

  return (
    <span className="relative flex h-5 w-5 shrink-0 items-center justify-center overflow-visible">
      {isActive && tab === 'pending-to-order' ? (
        <>
          <span className="vendor-order-plane-trail" aria-hidden />
          <span className="vendor-order-plane-trail vendor-order-plane-trail--delay" aria-hidden />
        </>
      ) : null}
      {isActive && tab === 'pending-to-receive' ? (
        <>
          <span className="vendor-order-truck-dust" aria-hidden />
          <span className="vendor-order-truck-dust vendor-order-truck-dust--delay" aria-hidden />
        </>
      ) : null}
      <Icon
        className={`h-4 w-4 shrink-0 ${isActive ? `text-white ${meta.iconAnimClass}` : meta.iconClass}`}
        strokeWidth={2.25}
        aria-hidden
      />
    </span>
  );
}

function VendorOrderTabButton({
  tab,
  isActive,
  count,
  onClick,
}: {
  tab: TabType;
  isActive: boolean;
  count: number;
  onClick: () => void;
}) {
  const meta = VENDOR_ORDER_TABS[tab];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all sm:px-4 ${
        isActive ? meta.activeTabClass : meta.inactiveTabClass
      }`}
    >
      <VendorOrderTabIcon tab={tab} isActive={isActive} meta={meta} />
      <span>{meta.label}</span>
      <span
        className={`ml-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs tabular-nums ${
          isActive ? 'bg-white/20 text-white' : meta.countBadgeClass
        }`}
      >
        {count}
      </span>
    </button>
  );
}

type VendorOrderActionTone = 'red' | 'orange' | 'pink' | 'slate' | 'amber' | 'green';

const VENDOR_ORDER_ACTION_TONES: Record<
  VendorOrderActionTone,
  { button: string; shadow: string }
> = {
  red: {
    button: 'bg-red-600 hover:bg-red-700',
    shadow: 'shadow-red-500/25',
  },
  orange: {
    button: 'bg-orange-500 hover:bg-orange-600',
    shadow: 'shadow-orange-500/25',
  },
  pink: {
    button: 'bg-pink-600 hover:bg-pink-700',
    shadow: 'shadow-pink-500/25',
  },
  slate: {
    button: 'bg-slate-600 hover:bg-slate-700',
    shadow: 'shadow-slate-500/25',
  },
  amber: {
    button: 'bg-amber-600 hover:bg-amber-700',
    shadow: 'shadow-amber-500/25',
  },
  green: {
    button: 'bg-emerald-600 hover:bg-emerald-700',
    shadow: 'shadow-emerald-500/25',
  },
};

function VendorOrderIconAction({
  label,
  icon: Icon,
  onClick,
  disabled,
  loading = false,
  loadingLabel,
  title,
  tone,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  title?: string;
  tone: VendorOrderActionTone;
}) {
  const styles = VENDOR_ORDER_ACTION_TONES[tone];
  const displayLabel = loading ? loadingLabel ?? label : label;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      title={title ?? label}
      aria-label={label}
      className={`vendor-order-icon-action group flex h-11 shrink-0 items-center overflow-hidden rounded-xl text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 shadow-lg ${styles.button} ${styles.shadow}`}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center">
        {loading ? (
          <div
            className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"
            aria-hidden
          />
        ) : (
          <Icon className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
        )}
      </span>
      <span className="vendor-order-icon-action__label grid min-w-0">
        <span className="min-w-0 overflow-hidden">
          <span className="vendor-order-icon-action__label-text block whitespace-nowrap">
            {displayLabel}
          </span>
        </span>
      </span>
    </button>
  );
}

/** Shared column widths for pending-to-receive item tables (same across every job card). */
const PendingToReceiveItemsColGroup = () => (
  <colgroup>
    <col style={{ width: '2.5rem' }} />
    <col style={{ width: '4.5rem' }} />
    <col style={{ width: '7.5rem' }} />
    <col />
    <col style={{ width: '5.5rem' }} />
    <col style={{ width: '5.5rem' }} />
    <col style={{ width: '7.5rem' }} />
    <col style={{ width: '9rem' }} />
    <col style={{ width: '10.5rem' }} />
  </colgroup>
);

type CancelOrderResultStatus = 'CANCELLED' | 'BLOCKED_IN_PO' | 'NOT_FOUND';

type CancelReceiveResultStatus = 'CANCELLED' | 'EMAIL_FAILED' | 'BLOCKED' | 'NOT_FOUND';

type CancelOrderTarget = {
  jobNumber: string;
  listNumber?: string | null;
  partNumber: string;
  itemKey: string;
  canCancel: boolean;
  cancelBlockReason?: string;
};

type ReceiveCancelTarget = {
  jobNumber: string;
  listNumber?: string | null;
  partNumber: string;
  itemKey: string;
  description: string | null;
  quantityOrdered: number;
  purchaseOrders: PendingToReceiveItem['purchaseOrders'];
  isFullyReceived?: boolean;
};

export default function AdminOrdersPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { hasPermission, isLoading: permissionsLoading } = usePermissions();
  
  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>('pending-to-order');
  
  // State for pending to order tab
  const [pendingToOrderJobs, setPendingToOrderJobs] = useState<PendingJob[]>([]);
  const [isLoadingPendingToOrder, setIsLoadingPendingToOrder] = useState(false);
  const [itemSuppliers, setItemSuppliers] = useState<Map<string, string>>(new Map());
  const [allVendors, setAllVendors] = useState<string[]>([]);
  const [isLoadingVendors, setIsLoadingVendors] = useState(false);
  const [manualOtherSelections, setManualOtherSelections] = useState<Set<string>>(new Set());
  const [customVendors, setCustomVendors] = useState<Map<string, string>>(new Map());
  
  // State for pending to receive tab
  const [pendingToReceiveJobs, setPendingToReceiveJobs] = useState<PendingToReceiveJob[]>([]);
  const [isLoadingPendingToReceive, setIsLoadingPendingToReceive] = useState(false);
  // State for order history tab
  const [pastOrders, setPastOrders] = useState<HistoryOrder[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [pendingToOrderSearch, setPendingToOrderSearch] = useState('');
  const [pendingToReceiveSearch, setPendingToReceiveSearch] = useState('');
  const [orderHistorySearch, setOrderHistorySearch] = useState('');
  
  // Shared state
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // Selection state (separate for each tab)
  const [selectedItemsToOrder, setSelectedItemsToOrder] = useState<Set<string>>(new Set());
  const [selectedItemsToReceive, setSelectedItemsToReceive] = useState<Set<string>>(new Set());
  
  // Quantity state for both tabs
  const [quantityOrdered, setQuantityOrdered] = useState<Map<string, number>>(new Map());
  const [quantityReceived, setQuantityReceived] = useState<Map<string, number>>(new Map());
  
  const [collapsedJobKeys, setCollapsedJobKeys] = useState<Set<string>>(new Set());

  // Action states
  const [isSending, setIsSending] = useState(false);
  const [isCancellingOrders, setIsCancellingOrders] = useState(false);
  const [isCancellingReceiveOrders, setIsCancellingReceiveOrders] = useState(false);
  const [isMarkingReceived, setIsMarkingReceived] = useState(false);
  const [isRevertingReceived, setIsRevertingReceived] = useState(false);
  const [isMarkingPickup, setIsMarkingPickup] = useState(false);
  const [isMarkingDeliveryToJobsite, setIsMarkingDeliveryToJobsite] = useState(false);
  const [isClearingDeliveryStatus, setIsClearingDeliveryStatus] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showCancelOrderModal, setShowCancelOrderModal] = useState(false);
  const [showCancelReceiveModal, setShowCancelReceiveModal] = useState(false);
  const [showCancelReceiveDispositionModal, setShowCancelReceiveDispositionModal] = useState(false);
  const [cancelReceiveDisposition, setCancelReceiveDisposition] = useState<'sendBackToInventory' | 'leaveAsIs'>('sendBackToInventory');
  const [cancelOrderTargets, setCancelOrderTargets] = useState<CancelOrderTarget[]>([]);
  const [cancelOrderBlockedCount, setCancelOrderBlockedCount] = useState(0);
  const [cancelOrderMode, setCancelOrderMode] = useState<'single' | 'bulk'>('bulk');
  const [cancelReceiveTargets, setCancelReceiveTargets] = useState<ReceiveCancelTarget[]>([]);
  const [sendResults, setSendResults] = useState<SendResult[]>([]);
  const [lastBatchId, setLastBatchId] = useState<string | null>(null);

  // Vendor hub state
  const [unifiedVendors, setUnifiedVendors] = useState<UnifiedVendor[]>([]);
  const [showVendorsHubModal, setShowVendorsHubModal] = useState(false);
  
  // Delete order history modal state
  const [showDeleteOrderModal, setShowDeleteOrderModal] = useState(false);
  const [orderToDelete, setOrderToDelete] = useState<HistoryOrder | null>(null);
  const [isDeletingOrder, setIsDeletingOrder] = useState(false);
  const [deleteOrderReceivedSummary, setDeleteOrderReceivedSummary] = useState<DeleteOrderReceivedSummary | null>(null);
  const [isLoadingDeleteOrderSummary, setIsLoadingDeleteOrderSummary] = useState(false);

  // Check if user is admin
  const roleIsAdmin = (session?.user as any)?.role === 'ADMIN';
  const isAdmin = permissionsLoading ? roleIsAdmin : hasPermission('orders.view');
  const canViewToOrderTab = permissionsLoading
    ? roleIsAdmin
    : hasPermission('orders.to_order.view');
  const canEditToOrderRows = permissionsLoading
    ? roleIsAdmin
    : hasPermission('orders.to_order.edit');
  const canReviewAndSendOrders = permissionsLoading
    ? roleIsAdmin
    : hasPermission('orders.generate_send');
  const canViewPendingOrderUpdates = permissionsLoading
    ? roleIsAdmin
    : hasPermission('orders.pending.view');
  const canViewOrderHistory = permissionsLoading
    ? roleIsAdmin
    : hasPermission('orders.history.view');
  const canDeleteOrderHistory = permissionsLoading
    ? roleIsAdmin
    : hasPermission('orders.history.delete');
  const canCancelPendingOrders = permissionsLoading
    ? roleIsAdmin
    : hasPermission('orders.cancel');
  const canMarkReceived = permissionsLoading
    ? roleIsAdmin
    : hasPermission('orders.mark_received');
  const canRevertReceived = permissionsLoading
    ? roleIsAdmin
    : hasPermission('orders.revert_received');
  const canMarkPickup = permissionsLoading
    ? roleIsAdmin
    : hasPermission('orders.mark_pickup');
  const canMarkJobsiteDelivery = permissionsLoading
    ? roleIsAdmin
    : hasPermission('orders.mark_jobsite_delivery');
  const canClearDeliveryStatus = permissionsLoading
    ? roleIsAdmin
    : hasPermission('orders.clear_delivery_status');
  const canManageSuppliers = permissionsLoading
    ? roleIsAdmin
    : hasPermission('orders.suppliers.manage');

  const sanitizeEmailListForDisplay = (emails: string[] | null | undefined) => {
    return (emails || [])
      .map((value) => String(value || '').trim())
      .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  };

  const loadUnifiedVendors = async () => {
    try {
      const response = await fetch('/api/admin/vendors', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to load vendors');
      }
      const data = await response.json();
      setUnifiedVendors((data.vendors || []) as UnifiedVendor[]);
    } catch (err) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Error loading unified vendors:', err);
      }
    }
  };

  const reloadDropdownVendors = async () => {
    try {
      setIsLoadingVendors(true);
      const response = await fetch('/api/parts/vendors', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!response.ok) {
        throw new Error('Failed to load vendors');
      }
      const data = await response.json();
      setAllVendors(data.vendors || []);
    } catch (err) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Error loading vendors:', err);
      }
    } finally {
      setIsLoadingVendors(false);
    }
  };

  const getDisplayPoLabel = (orderLike: { vendorPoLabel?: string | null; orderNumber: string }) =>
    orderLike.vendorPoLabel?.trim() || orderLike.orderNumber;

  const getJobListSummary = (items: Array<{ listNumber?: string | null }>) => {
    const listNumbers = Array.from(
      new Set(
        items
          .map((item) => String(item.listNumber ?? '').trim())
          .filter((value) => value.length > 0)
      )
    ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    return listNumbers.length > 0 ? listNumbers.join(', ') : '1';
  };

  const normalizeJobSearchValue = (value: string | null | undefined) =>
    String(value || '').trim().toLowerCase();

  /** Substring match that ignores spaces (e.g. "8 C200" matches "8C200"). */
  const compactLowerIncludes = (haystack: string | null | undefined, needle: string) => {
    const h = normalizeJobSearchValue(haystack).replace(/\s+/g, '');
    const n = needle.replace(/\s+/g, '');
    return n.length > 0 && h.includes(n);
  };

  const getJobListNumbersForSearch = (items: Array<{ listNumber?: string | null }>) =>
    Array.from(
      new Set(
        items
          .map((item) => String(item.listNumber ?? '').trim())
          .filter((value) => value.length > 0),
      ),
    );

  const filteredPendingToOrderJobs = useMemo(() => {
    const query = normalizeJobSearchValue(pendingToOrderSearch);
    if (!query) return pendingToOrderJobs;

    return pendingToOrderJobs.filter((job) => {
      const listNumbers = getJobListNumbersForSearch(job.items);
      return (
        normalizeJobSearchValue(job.jobNumber).includes(query) ||
        normalizeJobSearchValue(job.jobName).includes(query) ||
        normalizeJobSearchValue(job.area).includes(query) ||
        listNumbers.some((listNumber) =>
          normalizeJobSearchValue(listNumber).includes(query),
        )
      );
    });
  }, [pendingToOrderJobs, pendingToOrderSearch]);

  const filteredPendingToReceiveJobs = useMemo(() => {
    const query = normalizeJobSearchValue(pendingToReceiveSearch);
    if (!query) return pendingToReceiveJobs;

    return pendingToReceiveJobs.filter((job) => {
      const listNumbers = getJobListNumbersForSearch(job.items);
      return (
        normalizeJobSearchValue(job.jobNumber).includes(query) ||
        normalizeJobSearchValue(job.jobName).includes(query) ||
        normalizeJobSearchValue(job.area).includes(query) ||
        listNumbers.some((listNumber) =>
          normalizeJobSearchValue(listNumber).includes(query),
        )
      );
    });
  }, [pendingToReceiveJobs, pendingToReceiveSearch]);

  const filteredPastOrders = useMemo(() => {
    const query = normalizeJobSearchValue(orderHistorySearch);
    if (!query) return pastOrders;

    return pastOrders.filter((order) =>
      order.items.some(
        (item) =>
          normalizeJobSearchValue(item.jobNumber).includes(query) ||
          normalizeJobSearchValue(item.jobName).includes(query) ||
          normalizeJobSearchValue(item.area).includes(query) ||
          normalizeJobSearchValue(item.listNumber).includes(query) ||
          normalizeJobSearchValue(item.partNumber).includes(query) ||
          compactLowerIncludes(item.partNumber, query) ||
          normalizeJobSearchValue(item.description).includes(query) ||
          compactLowerIncludes(item.description, query),
      ),
    );
  }, [pastOrders, orderHistorySearch]);

  useEffect(() => {
    if (status === 'loading' || permissionsLoading) return;
    
    if (!session) {
      router.push('/login?callbackUrl=/admin/orders');
      return;
    }

    if (!isAdmin) return;

    // Load all tab counts on initial load, then load active tab data
    loadAllTabCounts();
    loadData();
  }, [session, status, permissionsLoading, isAdmin, router]);

  // Load tab data when activeTab changes
  useEffect(() => {
    if (status === 'loading' || permissionsLoading || !session || !isAdmin) return;
    loadData();
  }, [activeTab, permissionsLoading, session, status, isAdmin]);

  useEffect(() => {
    if (permissionsLoading || canViewPendingOrderUpdates || activeTab !== 'pending-to-receive') return;
    setActiveTab(canViewToOrderTab ? 'pending-to-order' : canViewOrderHistory ? 'order-history' : 'pending-to-order');
    setSelectedItemsToReceive(new Set());
    setQuantityReceived(new Map());
    setManualOtherSelections(new Set());
    setCustomVendors(new Map());
  }, [activeTab, canViewPendingOrderUpdates, canViewToOrderTab, canViewOrderHistory, permissionsLoading]);

  useEffect(() => {
    if (permissionsLoading || canViewToOrderTab || activeTab !== 'pending-to-order') return;
    setActiveTab(canViewPendingOrderUpdates ? 'pending-to-receive' : canViewOrderHistory ? 'order-history' : 'pending-to-order');
    setSelectedItemsToOrder(new Set());
    setQuantityOrdered(new Map());
    setManualOtherSelections(new Set());
    setCustomVendors(new Map());
  }, [activeTab, canViewToOrderTab, canViewPendingOrderUpdates, canViewOrderHistory, permissionsLoading]);

  useEffect(() => {
    if (permissionsLoading || canViewOrderHistory || activeTab !== 'order-history') return;
    setActiveTab(canViewToOrderTab ? 'pending-to-order' : canViewPendingOrderUpdates ? 'pending-to-receive' : 'pending-to-order');
    setOrderHistorySearch('');
  }, [activeTab, canViewOrderHistory, canViewToOrderTab, canViewPendingOrderUpdates, permissionsLoading]);

  useEffect(() => {
    if (status === 'loading' || permissionsLoading || !session) return;
    if (!canReviewAndSendOrders && !canManageSuppliers) return;
    void loadUnifiedVendors();
  }, [session, status, permissionsLoading, canReviewAndSendOrders, canManageSuppliers]);

  useEffect(() => {
    if (status === 'loading' || permissionsLoading || !session || !isAdmin) return;
    void reloadDropdownVendors();
  }, [session, status, permissionsLoading, isAdmin]);

  // Load counts for all tabs (to update tab badges)
  const loadAllTabCounts = async () => {
    try {
      // Load available tabs in parallel to get counts
      const [pendingToOrderResponse, pendingToReceiveResponse, historyResponse] = await Promise.all([
        canViewToOrderTab
          ? fetch(`/api/admin/orders/pending-to-order?t=${Date.now()}`, {
              cache: 'no-store',
              headers: { 'Cache-Control': 'no-cache' },
            })
          : Promise.resolve(null),
        canViewPendingOrderUpdates
          ? fetch(`/api/admin/orders/pending-to-receive?t=${Date.now()}`, {
              cache: 'no-store',
              headers: { 'Cache-Control': 'no-cache' },
            })
          : Promise.resolve(null),
        canViewOrderHistory
          ? fetch(`/api/admin/orders/history?t=${Date.now()}`, {
              cache: 'no-store',
              headers: { 'Cache-Control': 'no-cache' },
            })
          : Promise.resolve(null),
      ]);

      // Update pending to order data (for count)
      if (pendingToOrderResponse?.ok) {
        const data = await pendingToOrderResponse.json();
        setPendingToOrderJobs(data.jobs || []);
      } else if (!canViewToOrderTab) {
        setPendingToOrderJobs([]);
      }

      // Update pending to receive data (for count)
      if (pendingToReceiveResponse?.ok) {
        const data = await pendingToReceiveResponse.json();
        setPendingToReceiveJobs(data.jobs || []);
      } else if (!canViewPendingOrderUpdates) {
        setPendingToReceiveJobs([]);
      }

      // Update order history data (for count)
      if (historyResponse?.ok) {
        const data = await historyResponse.json();
        setPastOrders(data.orders || []);
      } else if (!canViewOrderHistory) {
        setPastOrders([]);
      }
    } catch (err) {
      // Silently fail for count loading - main loadData will handle errors
      if (process.env.NODE_ENV === 'development') {
        console.error('Error loading tab counts:', err);
      }
    }
  };

  // Load data based on active tab
  const loadData = async () => {
    try {
      setError(null);
      
      if (activeTab === 'pending-to-order') {
        if (!canViewToOrderTab) {
          setPendingToOrderJobs([]);
          return;
        }
        setIsLoadingPendingToOrder(true);
        try {
          // Add cache-busting to ensure fresh data
          const response = await fetch(`/api/admin/orders/pending-to-order?t=${Date.now()}`, {
            cache: 'no-store',
            headers: {
              'Cache-Control': 'no-cache',
            },
          });
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to load pending orders');
          }
          const data = await response.json();
          
          if (process.env.NODE_ENV === 'development') {
            console.log('[frontend] Pending to Order API Response:', {
              totalJobs: data.totalJobs,
              totalItems: data.totalItems,
              jobsCount: data.jobs?.length || 0,
              jobs: data.jobs,
            });
          }
          
          setPendingToOrderJobs(data.jobs || []);
          // Initialize quantityOrdered state from API so "Qty to Order" and send payload stay in sync (fixes partial-order revert bug)
          setQuantityOrdered((prev) => {
            const next = new Map(prev);
            (data.jobs || []).forEach((job: PendingJob) => {
              job.items.forEach((item: OrderItem) => {
                const key = `${job.jobNumber}::${(item.listNumber ?? '').toString().trim()}::${item.partNumber}`;
                const defaultQty =
                  item.remainingToOrder ??
                  getRemainingQty({
                    needed: item.quantityNeeded || 0,
                    fab: item.quantityFab || 0,
                    shop: item.quantityPulled || 0,
                    preorder: item.quantityPreordered || 0,
                    vendor: item.quantityReceivedFromOrder ?? 0,
                  });
                next.set(key, defaultQty);
              });
            });
            return next;
          });
        } catch (err) {
          if (process.env.NODE_ENV === 'development') {
            console.error('[frontend] Error loading pending to order:', err);
          }
          setError((err as Error).message);
          setPendingToOrderJobs([]);
        } finally {
          setIsLoadingPendingToOrder(false);
        }
      } else if (activeTab === 'pending-to-receive') {
        if (!canViewPendingOrderUpdates) {
          setPendingToReceiveJobs([]);
          return;
        }
        setIsLoadingPendingToReceive(true);
        try {
          const response = await fetch(`/api/admin/orders/pending-to-receive?t=${Date.now()}`, {
            cache: 'no-store',
            headers: {
              'Cache-Control': 'no-cache',
            },
          });
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to load pending to receive');
          }
          const data = await response.json();
          
          if (process.env.NODE_ENV === 'development') {
            console.log('[frontend] Pending to Receive API Response:', {
              totalJobs: data.totalJobs,
              totalItems: data.totalItems,
              jobsCount: data.jobs?.length || 0,
            });
          }
          
          setPendingToReceiveJobs(data.jobs || []);
        } catch (err) {
          if (process.env.NODE_ENV === 'development') {
            console.error('[frontend] Error loading pending to receive:', err);
          }
          setError((err as Error).message);
          setPendingToReceiveJobs([]);
        } finally {
          setIsLoadingPendingToReceive(false);
        }
      } else if (activeTab === 'order-history') {
        if (!canViewOrderHistory) {
          setPastOrders([]);
          return;
        }
        setIsLoadingHistory(true);
        try {
          const response = await fetch(`/api/admin/orders/history?t=${Date.now()}`, {
            cache: 'no-store',
            headers: {
              'Cache-Control': 'no-cache',
            },
          });
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to load order history');
          }
          const data = await response.json();
          
          if (process.env.NODE_ENV === 'development') {
            console.log('[frontend] Order History API Response:', {
              ordersCount: data.orders?.length || 0,
            });
          }
          
          setPastOrders(data.orders || []);
        } catch (err) {
          if (process.env.NODE_ENV === 'development') {
            console.error('[frontend] Error loading order history:', err);
          }
          setError((err as Error).message);
          setPastOrders([]);
        } finally {
          setIsLoadingHistory(false);
        }
      }
    } catch (err) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Error loading data:', err);
      }
      setError((err as Error).message);
      setIsLoadingPendingToOrder(false);
      setIsLoadingPendingToReceive(false);
      setIsLoadingHistory(false);
    }
  };

  /** List number for this job card (from first item). Used for unique keys when same job has multiple lists. */
  const getJobListForCard = (job: { items: Array<{ listNumber?: string | null }> }) => {
    const raw = job.items[0]?.listNumber;
    const s = raw != null ? String(raw).trim() : '';
    return s || '1';
  };

  /** Unique key for a job card. Required because API groups by job+list, so same jobNumber can appear multiple times. */
  const getJobCardKey = (job: { jobNumber: string; items: Array<{ listNumber?: string | null }> }) =>
    `${job.jobNumber}::${getJobListForCard(job)}`;

  /** Collapse key per job+list so multiple cards with same job number expand/collapse independently. */
  const getJobCollapseKey = (
    tab: 'pending-to-order' | 'pending-to-receive',
    jobNumber: string,
    listNumber: string,
  ) => `${tab}::${jobNumber}::${listNumber}`;

  // Toggle job collapse. Jobs default to expanded unless explicitly collapsed.
  const toggleJobExpanded = (
    tab: 'pending-to-order' | 'pending-to-receive',
    jobNumber: string,
    listNumber: string,
  ) => {
    const key = getJobCollapseKey(tab, jobNumber, listNumber);
    setCollapsedJobKeys((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  // Toggle order expansion (for order history)
  const toggleOrderExpanded = (orderId: string) => {
    setExpandedOrders((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(orderId)) {
        newSet.delete(orderId);
      } else {
        newSet.add(orderId);
      }
      return newSet;
    });
  };

  // Create unique key for an item
  const getItemKey = (jobNumber: string, partNumber: string, listNumber?: string | null) =>
    `${jobNumber}::${(listNumber ?? '').trim()}::${partNumber}`;

  const resolveReceiveQuantity = (
    item: PendingToReceiveItem,
    itemKey: string,
    isInventory: boolean,
  ): number => {
    const ordered = Math.max(0, Number(item.quantityOrdered ?? 0));
    const persisted = Math.max(
      0,
      Number(item.quantityReceived ?? item.quantityReceivedFromOrder ?? 0),
    );
    if (quantityReceived.has(itemKey)) {
      const edited = Number(quantityReceived.get(itemKey));
      if (!Number.isNaN(edited) && edited >= 0) {
        return edited;
      }
    }
    if (persisted > 0) {
      return persisted;
    }
    // Inventory replenishment must use an explicit received qty — never auto full-receive.
    if (isInventory) {
      return 0;
    }
    return ordered;
  };

  const receiveItemKey = (
    job: PendingToReceiveJob,
    item: PendingToReceiveItem,
  ): string => {
    const listNumber = job.isInventoryReplenishment
      ? (item.listNumber || INVENTORY_REORDER_LIST_NUMBER)
      : (item.listNumber || '1');
    return getItemKey(job.jobNumber, item.partNumber, listNumber);
  };

  const applyOptimisticReceiveUpdates = (
    receivedItems: Array<{
      jobNumber: string;
      listNumber: string;
      partNumber: string;
      quantityReceived?: number | null;
    }>,
  ) => {
    const receivedByKey = new Map(
      receivedItems.map((item) => [
        getItemKey(item.jobNumber, item.partNumber, item.listNumber),
        Math.max(0, Number(item.quantityReceived ?? 0)),
      ]),
    );

    setPendingToReceiveJobs((prev) =>
      prev.map((job) => ({
        ...job,
        items: job.items.map((item) => {
          const key = receiveItemKey(job, item);
          const nextReceived = receivedByKey.get(key);
          if (nextReceived === undefined) return item;

          const ordered = Math.max(0, Number(item.quantityOrdered ?? 0));
          return {
            ...item,
            quantityReceived: nextReceived,
            quantityReceivedFromOrder: nextReceived,
            isFullyReceived: ordered > 0 && nextReceived >= ordered,
          };
        }),
      })),
    );
  };

  // Toggle item selection (pending to order tab)
  const toggleItemSelectedToOrder = (jobNumber: string, partNumber: string, listNumber?: string) => {
    const key = getItemKey(jobNumber, partNumber, listNumber);
    setSelectedItemsToOrder((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  // Toggle item selection (pending to receive tab)
  const toggleItemSelectedToReceive = (jobNumber: string, partNumber: string, listNumber?: string) => {
    const key = getItemKey(jobNumber, partNumber, listNumber);
    setSelectedItemsToReceive((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  // Toggle all items in a job (pending to order)
  const toggleJobSelectedToOrder = (job: PendingJob) => {
    const jobItemKeys = job.items.map((item) => getItemKey(job.jobNumber, item.partNumber, item.listNumber));
    const allSelected = jobItemKeys.every((key) => selectedItemsToOrder.has(key));

    setSelectedItemsToOrder((prev) => {
      const newSet = new Set(prev);
      if (allSelected) {
        jobItemKeys.forEach((key) => newSet.delete(key));
      } else {
        jobItemKeys.forEach((key) => newSet.add(key));
      }
      return newSet;
    });
  };

  // Toggle all items in a job (pending to receive)
  const toggleJobSelectedToReceive = (job: PendingToReceiveJob) => {
    const jobItemKeys = job.items.map((item) => getItemKey(job.jobNumber, item.partNumber, item.listNumber));
    const allSelected = jobItemKeys.every((key) => selectedItemsToReceive.has(key));

    setSelectedItemsToReceive((prev) => {
      const newSet = new Set(prev);
      if (allSelected) {
        jobItemKeys.forEach((key) => newSet.delete(key));
      } else {
        jobItemKeys.forEach((key) => newSet.add(key));
      }
      return newSet;
    });
  };

  // Select all items (pending to order)
  const selectAllItemsToOrder = () => {
    const allKeys = filteredPendingToOrderJobs.flatMap((job) =>
      job.items.map((item) => getItemKey(job.jobNumber, item.partNumber, item.listNumber))
    );
    setSelectedItemsToOrder((prev) => new Set([...prev, ...allKeys]));
  };

  // Select all items (pending to receive)
  const selectAllItemsToReceive = () => {
    const allKeys = filteredPendingToReceiveJobs.flatMap((job) =>
      job.items.map((item) => getItemKey(job.jobNumber, item.partNumber, item.listNumber))
    );
    setSelectedItemsToReceive((prev) => new Set([...prev, ...allKeys]));
  };

  // Deselect all items
  const deselectAllItemsToOrder = () => {
    const visibleKeys = new Set(
      filteredPendingToOrderJobs.flatMap((job) =>
        job.items.map((item) => getItemKey(job.jobNumber, item.partNumber, item.listNumber))
      )
    );
    setSelectedItemsToOrder((prev) => {
      const next = new Set(prev);
      visibleKeys.forEach((key) => next.delete(key));
      return next;
    });
  };

  const deselectAllItemsToReceive = () => {
    const visibleKeys = new Set(
      filteredPendingToReceiveJobs.flatMap((job) =>
        job.items.map((item) => getItemKey(job.jobNumber, item.partNumber, item.listNumber))
      )
    );
    setSelectedItemsToReceive((prev) => {
      const next = new Set(prev);
      visibleKeys.forEach((key) => next.delete(key));
      return next;
    });
  };

  // Check if all items are selected
  const allItemsSelectedToOrder = () => {
    const visibleKeys = filteredPendingToOrderJobs.flatMap((job) =>
      job.items.map((item) => getItemKey(job.jobNumber, item.partNumber, item.listNumber))
    );
    if (visibleKeys.length === 0) return false;
    return visibleKeys.every((key) => selectedItemsToOrder.has(key));
  };

  const allItemsSelectedToReceive = () => {
    const visibleKeys = filteredPendingToReceiveJobs.flatMap((job) =>
      job.items.map((item) => getItemKey(job.jobNumber, item.partNumber, item.listNumber))
    );
    if (visibleKeys.length === 0) return false;
    return visibleKeys.every((key) => selectedItemsToReceive.has(key));
  };

  const pendingToOrderItemByKey = useMemo(() => {
    const map = new Map<string, { job: PendingJob; item: OrderItem }>();
    pendingToOrderJobs.forEach((job) => {
      job.items.forEach((item) => {
        map.set(getItemKey(job.jobNumber, item.partNumber, item.listNumber), { job, item });
      });
    });
    return map;
  }, [pendingToOrderJobs]);

  const selectedCancelTargets = useMemo(() => {
    const targets: CancelOrderTarget[] = [];
    selectedItemsToOrder.forEach((itemKey) => {
      const row = pendingToOrderItemByKey.get(itemKey);
      if (!row) return;
      const canCancel = row.item.canCancel !== false;
      targets.push({
        jobNumber: row.job.jobNumber,
        listNumber: row.item.listNumber || null,
        partNumber: row.item.partNumber,
        itemKey,
        canCancel,
        cancelBlockReason: row.item.cancelBlockReason,
      });
    });
    return targets;
  }, [selectedItemsToOrder, pendingToOrderItemByKey]);

  const selectedCancelableCount = selectedCancelTargets.filter((target) => target.canCancel).length;

  const selectedReceiveCancelTargets = useMemo(() => {
    const targets: ReceiveCancelTarget[] = [];
    pendingToReceiveJobs.forEach((job) => {
      job.items.forEach((item) => {
        const itemKey = getItemKey(job.jobNumber, item.partNumber, item.listNumber);
        if (!selectedItemsToReceive.has(itemKey)) return;
        const quantityOrdered = item.quantityOrdered !== null && item.quantityOrdered !== undefined
          ? item.quantityOrdered
          : getRemainingQty({
              needed: item.quantityNeeded || 0,
              fab: item.quantityFab || 0,
              shop: item.quantityPulled || 0,
              preorder: item.quantityPreordered || 0,
              vendor: item.quantityReceivedFromOrder || 0,
            });
        targets.push({
          jobNumber: job.jobNumber,
          listNumber: item.listNumber || null,
          partNumber: item.partNumber,
          itemKey,
          description: item.description || null,
          quantityOrdered,
          purchaseOrders: item.purchaseOrders || [],
          isFullyReceived: item.isFullyReceived,
        });
      });
    });
    return targets;
  }, [pendingToReceiveJobs, selectedItemsToReceive]);

  const selectedReceiveCancelRecipientGroups = useMemo(() => {
    const groups = new Map<string, {
      orderId: string;
      orderNumber: string;
      vendorPoLabel?: string | null;
      supplier?: string | null;
      to: string[];
      cc: string[];
      itemCount: number;
    }>();

    selectedReceiveCancelTargets.forEach((target) => {
      target.purchaseOrders.forEach((po) => {
        const key = po.orderId || `${po.orderNumber}::${po.supplier || ''}`;
        if (!groups.has(key)) {
          groups.set(key, {
            orderId: po.orderId,
            orderNumber: po.orderNumber,
            vendorPoLabel: po.vendorPoLabel || null,
            supplier: po.supplier || null,
            to: sanitizeEmailListForDisplay(po.recipientTo || []),
            cc: sanitizeEmailListForDisplay(po.recipientCc || []),
            itemCount: 0,
          });
        }
        groups.get(key)!.itemCount += 1;
      });
    });

    return Array.from(groups.values()).sort((a, b) => a.orderNumber.localeCompare(b.orderNumber));
  }, [selectedReceiveCancelTargets]);

  const buildSelectedReceiveLineItems = () => {
    const items: Array<{ jobNumber: string; listNumber: string; partNumber: string }> = [];
    pendingToReceiveJobs.forEach((job) => {
      job.items.forEach((item) => {
        const key = getItemKey(job.jobNumber, item.partNumber, item.listNumber);
        if (!selectedItemsToReceive.has(key)) return;
        items.push({
          jobNumber: job.jobNumber,
          listNumber: job.isInventoryReplenishment
            ? (item.listNumber || INVENTORY_REORDER_LIST_NUMBER)
            : (item.listNumber || '1'),
          partNumber: item.partNumber,
        });
      });
    });
    return items;
  };

  const selectedReceiveHasInventoryLines = useMemo(() => {
    return pendingToReceiveJobs.some(
      (job) =>
        job.isInventoryReplenishment === true &&
        job.items.some((item) =>
          selectedItemsToReceive.has(getItemKey(job.jobNumber, item.partNumber, item.listNumber)),
        ),
    );
  }, [pendingToReceiveJobs, selectedItemsToReceive]);

  const selectedReceivedCount = useMemo(() => {
    return selectedReceiveCancelTargets.filter((t) => t.isFullyReceived).length;
  }, [selectedReceiveCancelTargets]);

  // True when all selected items in Pending to Receive are fully received (have Received badge)
  const allSelectedItemsAreFullyReceived = useMemo(() => {
    if (selectedItemsToReceive.size === 0) return false;
    let count = 0;
    let fullyReceivedCount = 0;
    pendingToReceiveJobs.forEach((job) => {
      job.items.forEach((item) => {
        const key = getItemKey(job.jobNumber, item.partNumber, item.listNumber);
        if (!selectedItemsToReceive.has(key)) return;
        count += 1;
        if (item.isFullyReceived) fullyReceivedCount += 1;
      });
    });
    return count > 0 && count === fullyReceivedCount;
  }, [pendingToReceiveJobs, selectedItemsToReceive]);

  const cancelReceiveRecipientGroups = useMemo(() => {
    const targetKeys = new Set(cancelReceiveTargets.map((target) => target.itemKey));
    if (targetKeys.size === 0) return selectedReceiveCancelRecipientGroups;
    const groups = new Map<string, {
      orderId: string;
      orderNumber: string;
      vendorPoLabel?: string | null;
      supplier?: string | null;
      to: string[];
      cc: string[];
      itemCount: number;
    }>();
    cancelReceiveTargets.forEach((target) => {
      target.purchaseOrders.forEach((po) => {
        const groupKey = po.orderId || `${po.orderNumber}::${po.supplier || ''}`;
        if (!groups.has(groupKey)) {
          groups.set(groupKey, {
            orderId: po.orderId,
            orderNumber: po.orderNumber,
            vendorPoLabel: po.vendorPoLabel || null,
            supplier: po.supplier || null,
            to: sanitizeEmailListForDisplay(po.recipientTo || []),
            cc: sanitizeEmailListForDisplay(po.recipientCc || []),
            itemCount: 0,
          });
        }
        groups.get(groupKey)!.itemCount += 1;
      });
    });
    return Array.from(groups.values()).sort((a, b) => a.orderNumber.localeCompare(b.orderNumber));
  }, [cancelReceiveTargets, selectedReceiveCancelRecipientGroups]);

  const getCurrentSupplier = (jobNumber: string, partNumber: string, fallbackVendor: string | null, listNumber?: string | null) => {
    const key = getItemKey(jobNumber, partNumber, listNumber);
    return itemSuppliers.get(key) ?? fallbackVendor ?? 'Unassigned';
  };

  const setCurrentSupplier = (jobNumber: string, partNumber: string, supplier: string, listNumber?: string | null) => {
    const key = getItemKey(jobNumber, partNumber, listNumber);
    setItemSuppliers((prev) => {
      const next = new Map(prev);
      next.set(key, supplier);
      return next;
    });
  };

  const getVendorDropdownValue = (itemKey: string, supplier: string) => {
    if (manualOtherSelections.has(itemKey)) return 'Other';
    const normalized = normalizeVendorKey(supplier);
    if (!normalized) return '';
    return allVendors.includes(normalized) ? normalized : 'Other';
  };

  const getCustomVendorValue = (itemKey: string, supplier: string) => {
    if (customVendors.has(itemKey)) {
      return customVendors.get(itemKey) || '';
    }
    return getVendorDropdownValue(itemKey, supplier) === 'Other' ? supplier : '';
  };

  const handleVendorDropdownChange = (
    jobNumber: string,
    partNumber: string,
    listNumber: string | undefined,
    selectedValue: string,
    currentSupplier: string
  ) => {
    const itemKey = getItemKey(jobNumber, partNumber, listNumber);
    if (selectedValue === 'Other') {
      setManualOtherSelections((prev) => {
        const next = new Set(prev);
        next.add(itemKey);
        return next;
      });
      const initialCustom = allVendors.includes(normalizeVendorKey(currentSupplier)) ? '' : currentSupplier;
      setCustomVendors((prev) => {
        const next = new Map(prev);
        next.set(itemKey, initialCustom);
        return next;
      });
      setCurrentSupplier(jobNumber, partNumber, initialCustom, listNumber);
      return;
    }

    setManualOtherSelections((prev) => {
      const next = new Set(prev);
      next.delete(itemKey);
      return next;
    });
    setCustomVendors((prev) => {
      const next = new Map(prev);
      next.delete(itemKey);
      return next;
    });
    setCurrentSupplier(jobNumber, partNumber, normalizeVendorKey(selectedValue), listNumber);
  };

  const handleCustomVendorChange = (jobNumber: string, partNumber: string, value: string, listNumber?: string) => {
    const itemKey = getItemKey(jobNumber, partNumber, listNumber);
    setCustomVendors((prev) => {
      const next = new Map(prev);
      next.set(itemKey, value);
      return next;
    });
    setCurrentSupplier(jobNumber, partNumber, normalizeVendorKey(value), listNumber);
  };

  const buildSelectedOrderItems = () => {
    const items: Array<{
      jobNumber: string;
      listNumber?: string | null;
      jobName: string;
      partNumber: string;
      description: string | null;
      uom?: string | null;
      quantityOrdered: number;
      supplier: string | null;
    }> = [];

    pendingToOrderJobs.forEach((job) => {
      job.items.forEach((item) => {
        const key = getItemKey(job.jobNumber, item.partNumber, item.listNumber);
        if (!selectedItemsToOrder.has(key)) return;

        const orderedQty =
          quantityOrdered.get(key) ??
          item.remainingToOrder ??
          getRemainingQty({
            needed: item.quantityNeeded || 0,
            fab: item.quantityFab || 0,
            shop: item.quantityPulled || 0,
            preorder: item.quantityPreordered || 0,
            vendor: item.quantityReceivedFromOrder || 0,
          });

        if (orderedQty <= 0) return;

        items.push({
          jobNumber: job.jobNumber,
          listNumber: item.listNumber || null,
          jobName: job.jobName,
          partNumber: item.partNumber,
          description: item.description,
          uom: item.uom ?? null,
          quantityOrdered: orderedQty,
          supplier: getCurrentSupplier(job.jobNumber, item.partNumber, item.vendor, item.listNumber),
        });
      });
    });

    return items;
  };

  const openReviewModal = async () => {
    if (selectedItemsToOrder.size === 0) return;
    const items = buildSelectedOrderItems();
    if (items.length === 0) {
      setError('No valid items to send. Please ensure quantities are set.');
      return;
    }
    await loadUnifiedVendors();
    setShowReviewModal(true);
  };

  const handleSendOrder = async () => {
    if (selectedItemsToOrder.size === 0) return;

    try {
      setIsSending(true);
      setError(null);

      const items = buildSelectedOrderItems();
      if (items.length === 0) {
        setError('No valid items to send. Please ensure quantities are set.');
        return;
      }

      const emptyOtherVendorItem = items.find((item) => {
        const itemKey = getItemKey(item.jobNumber, item.partNumber, item.listNumber);
        return manualOtherSelections.has(itemKey) && !String(item.supplier || '').trim();
      });
      if (emptyOtherVendorItem) {
        setError(
          `Vendor is required for ${emptyOtherVendorItem.partNumber} on job ${emptyOtherVendorItem.jobNumber}. Please enter a custom vendor name or choose a vendor from the list.`
        );
        return;
      }

      const response = await fetch('/api/admin/orders/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to send order');
      }

      const data = await response.json();
      const results = (data.supplierResults || []) as SendResult[];
      setSendResults(results);
      setLastBatchId(data.batchId || null);

      const failedCount = results.filter((r) => r.sendStatus === 'FAILED').length;
      const totalCount = results.length;
      const sentCount = totalCount - failedCount;
      if (failedCount === 0) {
        setSuccessMessage(`Order sent successfully! Purchase requests were emailed to all ${totalCount} supplier${totalCount === 1 ? '' : 's'}.`);
      } else if (sentCount > 0) {
        setSuccessMessage(`Order partially completed. ${sentCount} of ${totalCount} supplier${totalCount === 1 ? '' : 's'} received the purchase request. Some could not be delivered—please contact your administrator for assistance.`);
      } else {
        setSuccessMessage(`Order could not be sent. The purchase order email webhook did not run successfully. See details below.`);
      }

      setSelectedItemsToOrder(new Set());
      setQuantityOrdered(new Map());
      setManualOtherSelections(new Set());
      setCustomVendors(new Map());
      setShowReviewModal(false);

      await loadAllTabCounts();
      await loadData();
      setTimeout(() => setSuccessMessage(null), 7000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSending(false);
    }
  };

  const closeCancelOrderModal = () => {
    setShowCancelOrderModal(false);
    setCancelOrderTargets([]);
    setCancelOrderBlockedCount(0);
  };

  const openBulkCancelModal = () => {
    if (selectedItemsToOrder.size === 0) return;
    const cancellableTargets = selectedCancelTargets.filter((target) => target.canCancel);
    if (cancellableTargets.length === 0) {
      setError('Selected items are already in a sent purchase order and cannot be canceled here.');
      return;
    }
    setCancelOrderMode('bulk');
    setCancelOrderTargets(cancellableTargets);
    setCancelOrderBlockedCount(selectedCancelTargets.length - cancellableTargets.length);
    setShowCancelOrderModal(true);
  };

  const openSingleCancelModal = (jobNumber: string, item: OrderItem) => {
    const itemKey = getItemKey(jobNumber, item.partNumber, item.listNumber);
    const canCancel = item.canCancel !== false;
    if (!canCancel) {
      setError(item.cancelBlockReason || 'This line was already sent in a purchase order and cannot be canceled.');
      return;
    }
    setCancelOrderMode('single');
    setCancelOrderTargets([
      {
        jobNumber,
        listNumber: item.listNumber || null,
        partNumber: item.partNumber,
        itemKey,
        canCancel: true,
        cancelBlockReason: item.cancelBlockReason,
      },
    ]);
    setCancelOrderBlockedCount(0);
    setShowCancelOrderModal(true);
  };

  const handleConfirmCancelOrders = async () => {
    if (cancelOrderTargets.length === 0) return;
    try {
      setIsCancellingOrders(true);
      setError(null);

      const response = await fetch('/api/admin/orders/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'strict',
          items: cancelOrderTargets.map((target) => ({
            jobNumber: target.jobNumber,
            listNumber: target.listNumber || null,
            partNumber: target.partNumber,
          })),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to cancel order items');
      }

      const data = await response.json() as {
        cancelledCount: number;
        blockedCount: number;
        notFoundCount: number;
        results: Array<{
          jobNumber: string;
          listNumber: string | null;
          partNumber: string;
          status: CancelOrderResultStatus;
          reason?: string;
        }>;
      };

      const cancelledKeys = new Set(
        (data.results || [])
          .filter((result) => result.status === 'CANCELLED')
          .map((result) => getItemKey(result.jobNumber, result.partNumber, result.listNumber))
      );

      if (cancelledKeys.size > 0) {
        setSelectedItemsToOrder((prev) => {
          const next = new Set(prev);
          cancelledKeys.forEach((key) => next.delete(key));
          return next;
        });
        setQuantityOrdered((prev) => {
          const next = new Map(prev);
          cancelledKeys.forEach((key) => next.delete(key));
          return next;
        });
        setItemSuppliers((prev) => {
          const next = new Map(prev);
          cancelledKeys.forEach((key) => next.delete(key));
          return next;
        });
        setManualOtherSelections((prev) => {
          const next = new Set(prev);
          cancelledKeys.forEach((key) => next.delete(key));
          return next;
        });
        setCustomVendors((prev) => {
          const next = new Map(prev);
          cancelledKeys.forEach((key) => next.delete(key));
          return next;
        });
      }

      const messageParts = [`Canceled ${data.cancelledCount || 0} item(s).`];
      if ((data.blockedCount || 0) > 0) {
        messageParts.push(`${data.blockedCount} blocked (already sent in Purchase Order).`);
      }
      if ((data.notFoundCount || 0) > 0) {
        messageParts.push(`${data.notFoundCount} not found.`);
      }
      setSendResults([]);
      setLastBatchId(null);
      setSuccessMessage(messageParts.join(' '));

      closeCancelOrderModal();
      await loadAllTabCounts();
      await loadData();
      setTimeout(() => setSuccessMessage(null), 6000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsCancellingOrders(false);
    }
  };

  const openCancelReceiveModal = () => {
    if (!canCancelPendingOrders) return;
    if (selectedReceiveCancelTargets.length === 0) return;
    setCancelReceiveTargets(selectedReceiveCancelTargets);
    if (selectedReceivedCount > 0) {
      setCancelReceiveDisposition('sendBackToInventory');
      setShowCancelReceiveDispositionModal(true);
    } else {
      setShowCancelReceiveModal(true);
    }
  };

  const closeCancelReceiveModal = () => {
    if (isCancellingReceiveOrders) return;
    setShowCancelReceiveModal(false);
    setShowCancelReceiveDispositionModal(false);
    setCancelReceiveTargets([]);
  };

  const handleConfirmCancelReceiveOrders = async (disposition?: 'sendBackToInventory' | 'leaveAsIs') => {
    if (cancelReceiveTargets.length === 0) return;
    try {
      setIsCancellingReceiveOrders(true);
      setError(null);

      const allSelectedAreReceived = cancelReceiveTargets.every((t) => t.isFullyReceived);
      const body: {
        items: Array<{ jobNumber: string; listNumber: string | null; partNumber: string }>;
        disposition?: 'sendBackToInventory' | 'leaveAsIs';
        skipEmails?: boolean;
      } = {
        items: cancelReceiveTargets.map((target) => ({
          jobNumber: target.jobNumber,
          listNumber: target.listNumber || null,
          partNumber: target.partNumber,
        })),
      };
      if (disposition) body.disposition = disposition;
      if (allSelectedAreReceived) body.skipEmails = true;

      const response = await fetch('/api/admin/orders/cancel-receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to cancel selected receive orders');
      }

      const data = await response.json() as {
        cancelledCount: number;
        emailedCount: number;
        failedEmailCount: number;
        blockedCount: number;
        notFoundCount: number;
        results: Array<{
          jobNumber: string;
          listNumber: string | null;
          partNumber: string;
          status: CancelReceiveResultStatus;
        }>;
      };

      const cancelledKeys = new Set(
        (data.results || [])
          .filter((result) => result.status === 'CANCELLED' || result.status === 'EMAIL_FAILED')
          .map((result) => getItemKey(result.jobNumber, result.partNumber, result.listNumber))
      );

      if (cancelledKeys.size > 0) {
        setSelectedItemsToReceive((prev) => {
          const next = new Set(prev);
          cancelledKeys.forEach((key) => next.delete(key));
          return next;
        });
        setQuantityReceived((prev) => {
          const next = new Map(prev);
          cancelledKeys.forEach((key) => next.delete(key));
          return next;
        });
      }

      setSendResults([]);
      setLastBatchId(null);
      const messageParts = [
        `Canceled ${data.cancelledCount || 0} selected order line(s).`,
      ];
      if ((data.emailedCount || 0) > 0) messageParts.push(`Emails sent: ${data.emailedCount}.`);
      if ((data.failedEmailCount || 0) > 0) messageParts.push(`Email failures: ${data.failedEmailCount}.`);
      if ((data.blockedCount || 0) > 0) messageParts.push(`Blocked: ${data.blockedCount}.`);
      if ((data.notFoundCount || 0) > 0) messageParts.push(`Not found: ${data.notFoundCount}.`);
      setSuccessMessage(messageParts.join(' '));

      closeCancelReceiveModal();
      await loadAllTabCounts();
      await loadData();
      setTimeout(() => setSuccessMessage(null), 7000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsCancellingReceiveOrders(false);
    }
  };

  // Mark received handler - builds items array from selected items in pendingToReceiveJobs
  const handleMarkReceived = async () => {
    if (!canMarkReceived) return;
    if (selectedItemsToReceive.size === 0) return;

    try {
      setIsMarkingReceived(true);
      setError(null);

      // Build items array from selected items
      const items: Array<{
        jobNumber: string;
        listNumber: string;
        partNumber: string;
        quantityReceived?: number | null;
        orderId?: string | null;
      }> = [];

      pendingToReceiveJobs.forEach((job) => {
        job.items.forEach((item) => {
          const key = getItemKey(job.jobNumber, item.partNumber, item.listNumber);
          if (selectedItemsToReceive.has(key)) {
            const qtyToUse = resolveReceiveQuantity(item, key, job.isInventoryReplenishment === true);
            const listNumber = job.isInventoryReplenishment
              ? (item.listNumber || INVENTORY_REORDER_LIST_NUMBER)
              : (item.listNumber || '1');

            if (job.isInventoryReplenishment && qtyToUse <= 0) {
              throw new Error(
                `Enter a received quantity greater than 0 for inventory part ${item.partNumber}.`,
              );
            }

            items.push({
              jobNumber: job.jobNumber,
              listNumber,
              partNumber: item.partNumber,
              quantityReceived: qtyToUse,
              orderId: job.isInventoryReplenishment ? (item.purchaseOrders[0]?.orderId ?? null) : null,
            });
          }
        });
      });

      if (items.length === 0) {
        setError('No items selected to mark as received.');
        setIsMarkingReceived(false);
        return;
      }

      // Call API to mark items as received
      const response = await fetch('/api/admin/orders/mark-received', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to mark items as received');
      }

      const data = await response.json();
      const partialCount = items.filter((item) => {
        const job = pendingToReceiveJobs.find((j) => j.jobNumber === item.jobNumber);
        const line = job?.items.find(
          (row) =>
            row.partNumber === item.partNumber &&
            (row.listNumber || (job?.isInventoryReplenishment ? INVENTORY_REORDER_LIST_NUMBER : '1')) === item.listNumber,
        );
        const ordered = Math.max(0, Number(line?.quantityOrdered ?? 0));
        const received = Math.max(0, Number(item.quantityReceived ?? 0));
        return ordered > 0 && received > 0 && received < ordered;
      }).length;
      setSuccessMessage(
        partialCount > 0
          ? `Recorded partial receive on ${partialCount} item(s). They will stay on On Order until fully received.`
          : `Marked ${data.updatedCount} item(s) as received successfully!`,
      );
      applyOptimisticReceiveUpdates(items);
      setSelectedItemsToReceive(new Set());
      setQuantityReceived(new Map());
      
      // Reload data to refresh the lists
      await loadAllTabCounts();
      await loadData();

      // Clear success message after 5 seconds
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Error marking items as received:', err);
      }
      setError((err as Error).message);
    } finally {
      setIsMarkingReceived(false);
    }
  };

  const handleRevertReceived = async () => {
    if (!canRevertReceived) return;
    if (selectedItemsToReceive.size === 0 || !allSelectedItemsAreFullyReceived) return;

    try {
      setIsRevertingReceived(true);
      setError(null);

      const items = buildSelectedReceiveLineItems();
      if (items.length === 0) {
        setError('No items selected to revert.');
        setIsRevertingReceived(false);
        return;
      }

      const response = await fetch('/api/admin/orders/revert-received', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to revert received status');
      }

      const data = await response.json();
      setSuccessMessage(`Reverted ${data.updatedCount} item(s) to Pick up / Jobsite Delivery.`);
      setSelectedItemsToReceive(new Set());
      setQuantityReceived(new Map());
      await loadAllTabCounts();
      await loadData();
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Error reverting received:', err);
      }
      setError((err as Error).message);
    } finally {
      setIsRevertingReceived(false);
    }
  };

  const handleMarkPickup = async () => {
    if (!canMarkPickup) return;
    if (selectedItemsToReceive.size === 0) return;

    try {
      setIsMarkingPickup(true);
      setError(null);

      const items = buildSelectedReceiveLineItems();

      if (items.length === 0) {
        setError('No items selected to mark as pickup.');
        return;
      }

      const response = await fetch('/api/admin/orders/mark-pickup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to mark items as pickup');
      }

      const data = await response.json();
      setSuccessMessage(`Marked ${data.updatedCount} item(s) as pickup from supplier.`);
      await loadAllTabCounts();
      await loadData();
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsMarkingPickup(false);
    }
  };

  const handleMarkDeliveryToJobsite = async () => {
    if (!canMarkJobsiteDelivery) return;
    if (selectedItemsToReceive.size === 0) return;

    try {
      setIsMarkingDeliveryToJobsite(true);
      setError(null);

      const items = buildSelectedReceiveLineItems();

      if (items.length === 0) {
        setError('No items selected to mark as supplier delivery.');
        return;
      }

      const response = await fetch('/api/admin/orders/mark-delivery-to-jobsite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to mark items as supplier delivery');
      }

      const data = await response.json();
      setSuccessMessage(`Marked ${data.updatedCount} item(s) as delivery to jobsite by supplier.`);
      await loadAllTabCounts();
      await loadData();
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsMarkingDeliveryToJobsite(false);
    }
  };

  const handleClearDeliveryStatus = async () => {
    if (!canClearDeliveryStatus) return;
    if (selectedItemsToReceive.size === 0) return;

    try {
      setIsClearingDeliveryStatus(true);
      setError(null);

      const items = buildSelectedReceiveLineItems();

      if (items.length === 0) {
        setError('No items selected to clear delivery status.');
        return;
      }

      const response = await fetch('/api/admin/orders/clear-delivery-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to clear delivery status');
      }

      const data = await response.json();
      setSuccessMessage(`Cleared transit status for ${data.updatedCount} item(s).`);
      await loadAllTabCounts();
      await loadData();
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsClearingDeliveryStatus(false);
    }
  };

  // Mark all items in a PurchaseOrder as received
  const handleMarkOrderReceived = async (orderId: string, orderNumber: string) => {
    if (!canMarkReceived) return;
    try {
      setIsMarkingReceived(true);
      setError(null);

      // Find the order in pastOrders
      const order = pastOrders.find(o => o.id === orderId || o.orderNumber === orderNumber);
      
      if (!order || !order.items || order.items.length === 0) {
        setError('Order not found or has no items');
        setIsMarkingReceived(false);
        return;
      }

      // Build items array from order items
      const items: Array<{ jobNumber: string; listNumber?: string | null; partNumber: string; quantityReceived?: number | null }> = order.items.map(item => ({
        jobNumber: item.jobNumber,
        listNumber: item.listNumber || null,
        partNumber: item.partNumber,
        quantityReceived: item.quantityOrdered, // Mark all items with their ordered quantity
      }));

      // Call API to mark items as received
      const response = await fetch('/api/admin/orders/mark-received', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to mark order as received');
      }

      const data = await response.json();
      const orderLabel = getDisplayPoLabel(order);
      setSuccessMessage(`Marked order ${orderLabel} as received! ${data.updatedCount} item(s) updated.`);
      setSelectedItemsToReceive(new Set());
      setQuantityReceived(new Map());
      
      // Reload data to refresh the lists
      await loadAllTabCounts(); // Reload all tab counts
      await loadData(); // Reload active tab data

      // Clear success message after 5 seconds
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Error marking order as received:', err);
      }
      setError((err as Error).message);
    } finally {
      setIsMarkingReceived(false);
    }
  };

  const closeDeleteOrderModal = () => {
    if (isDeletingOrder) return;
    setShowDeleteOrderModal(false);
    setOrderToDelete(null);
    setDeleteOrderReceivedSummary(null);
    setIsLoadingDeleteOrderSummary(false);
  };

  // Open delete order history confirmation modal
  const openDeleteOrderModal = async (order: HistoryOrder) => {
    setOrderToDelete(order);
    setShowDeleteOrderModal(true);
    setDeleteOrderReceivedSummary(null);
    setIsLoadingDeleteOrderSummary(true);

    try {
      const response = await fetch(`/api/admin/orders/history/${order.id}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to check received quantities for this order');
      }

      const data = await response.json();
      setDeleteOrderReceivedSummary({
        hasReceivedParts: Boolean(data.hasReceivedParts),
        receivedPartLines: Number(data.receivedPartLines) || 0,
        totalReceivedQuantity: Number(data.totalReceivedQuantity) || 0,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoadingDeleteOrderSummary(false);
    }
  };

  // Confirm delete order history - optional inventory return for received parts
  const handleConfirmDeleteOrder = async (returnToInventory = true) => {
    if (!orderToDelete) return;
    try {
      setIsDeletingOrder(true);
      setError(null);

      const response = await fetch(`/api/admin/orders/history/${orderToDelete.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ returnToInventory }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete order');
      }

      const data = await response.json();
      const deletedOrderLabel = getDisplayPoLabel(orderToDelete);
      if (returnToInventory) {
        setSuccessMessage(
          `Order ${deletedOrderLabel} deleted. ${data.unpulledCount ?? 0} received part(s) added to inventory.`
        );
      } else {
        setSuccessMessage(
          `Order ${deletedOrderLabel} deleted. ${data.clearedReceivedCount ?? 0} received part(s) were not added to inventory.`
        );
      }
      closeDeleteOrderModal();

      await loadAllTabCounts();
      await loadData();

      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsDeletingOrder(false);
    }
  };

  const copySupplierCsv = async (
    supplierName: string,
    items: Array<{
      jobNumber: string;
      jobName: string;
      partNumber: string;
      description: string | null;
      quantityOrdered: number;
      supplier: string | null;
    }>
  ) => {
    const lines = [
      'Part Number,Description,Quantity,Job Number,Job Name,Supplier',
      ...items.map((item) => {
        const safe = (value: string | null | undefined) => `"${(value || '').replace(/"/g, '""')}"`;
        return [
          safe(item.partNumber),
          safe(item.description || ''),
          item.quantityOrdered,
          safe(item.jobNumber),
          safe(item.jobName),
          safe(supplierName),
        ].join(',');
      }),
    ];
    await navigator.clipboard.writeText(lines.join('\n'));
    setSuccessMessage(`Copied ${items.length} ${supplierName} line item(s) as CSV.`);
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  const totalPendingToOrderItems = filteredPendingToOrderJobs.reduce((sum, job) => sum + job.items.length, 0);
  const totalPendingToReceiveItems = filteredPendingToReceiveJobs.reduce((sum, job) => sum + job.items.length, 0);
  const selectedItemsCount = activeTab === 'pending-to-order' ? selectedItemsToOrder.size : selectedItemsToReceive.size;
  const selectedOrderItemsForReview = useMemo(() => buildSelectedOrderItems(), [pendingToOrderJobs, selectedItemsToOrder, quantityOrdered, itemSuppliers]);
  const vendorDirectoryMap = useMemo(
    () =>
      new Map(
        unifiedVendors
          .filter((vendor) => vendor.isMaster && vendor.isActive)
          .map((vendor) => [vendor.vendorKey, vendor]),
      ),
    [unifiedVendors],
  );
  const reviewGroups = useMemo(() => {
    const groups = new Map<string, typeof selectedOrderItemsForReview>();
    selectedOrderItemsForReview.forEach((item) => {
      const key = normalizeSupplierKey(item.supplier);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    });
    return Array.from(groups.entries()).map(([supplierKey, items]) => {
      const entry = vendorDirectoryMap.get(supplierKey);
      const toEmails = sanitizeEmailListForDisplay(entry?.toEmails);
      const ccEmails = sanitizeEmailListForDisplay(entry?.ccEmails);
      const fallbackToPurchasing = toEmails.length === 0;
      return {
        supplierKey,
        supplierName: displaySupplierName(supplierKey),
        items,
        toEmails: fallbackToPurchasing ? ['purchasing@totalfire.biz'] : toEmails,
        ccEmails: Array.from(new Set([...(ccEmails || []), 'purchasing@totalfire.biz'])),
        fallbackToPurchasing,
        needsSetup: fallbackToPurchasing,
      };
    });
  }, [selectedOrderItemsForReview, vendorDirectoryMap]);
  const reviewGroupsNeedingSetup = reviewGroups.filter((group) => group.needsSetup).length;

  const isLoading = status === 'loading' ||
    permissionsLoading ||
    (activeTab === 'pending-to-order' && isLoadingPendingToOrder) ||
    (activeTab === 'pending-to-receive' && isLoadingPendingToReceive) ||
    (activeTab === 'order-history' && isLoadingHistory);

  if (status === 'loading' || permissionsLoading || isLoading) {
    return (
      <div className="min-h-screen bg-slate-100 dark:bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-slate-600 dark:text-slate-400 font-medium">Loading orders...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="h-screen bg-gray-50 dark:bg-slate-900 flex">
        <DashboardSidebar />
        <div className="pointer-events-none flex min-w-0 flex-1 select-none flex-col gap-4 overflow-hidden p-6 blur-sm opacity-60">
          <div className="h-24 rounded-xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60" />
          <div className="grid flex-1 gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60" />
            <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60" />
            <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60" />
          </div>
        </div>
        <AccessDeniedOverlay message="You do not have permission to view Vendor Orders." />
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
        <header className="bg-white dark:bg-slate-800/60 border-b border-gray-200 dark:border-slate-700/50">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white">
                  Vendor Orders
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-medium">
                  Send purchase orders, track deliveries, and review past orders
                </p>
              </div>
              
              {/* Action Button - changes based on active tab */}
              {activeTab === 'pending-to-order' && canReviewAndSendOrders && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={openReviewModal}
                    disabled={selectedItemsToOrder.size === 0 || isSending || isCancellingOrders}
                    className="px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-500/20 flex items-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                    Review & Send
                  </button>
                </div>
              )}
              
              {activeTab === 'pending-to-receive' && canViewPendingOrderUpdates && (
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 rounded-2xl border border-slate-200/90 bg-slate-50/90 p-1.5 dark:border-slate-600/60 dark:bg-slate-900/50">
                  {canCancelPendingOrders ? (
                    <VendorOrderIconAction
                      label="Cancel Order"
                      icon={Trash2}
                      tone="red"
                      onClick={openCancelReceiveModal}
                      loading={isCancellingReceiveOrders}
                      loadingLabel="Canceling..."
                      disabled={
                        selectedItemsToReceive.size === 0 ||
                        allSelectedItemsAreFullyReceived ||
                        isMarkingPickup ||
                        isMarkingDeliveryToJobsite ||
                        isClearingDeliveryStatus ||
                        isMarkingReceived ||
                        isRevertingReceived
                      }
                    />
                  ) : null}
                  {canMarkPickup ? (
                    <VendorOrderIconAction
                      label="Pick Up"
                      icon={Warehouse}
                      tone="orange"
                      onClick={handleMarkPickup}
                      loading={isMarkingPickup}
                      loadingLabel="Marking..."
                      title={
                        selectedReceiveHasInventoryLines
                          ? 'Pick Up applies to job orders only. Inventory replenishment uses Receive.'
                          : undefined
                      }
                      disabled={
                        selectedItemsToReceive.size === 0 ||
                        selectedReceiveHasInventoryLines ||
                        allSelectedItemsAreFullyReceived ||
                        isMarkingDeliveryToJobsite ||
                        isClearingDeliveryStatus ||
                        isMarkingReceived ||
                        isRevertingReceived ||
                        isCancellingReceiveOrders
                      }
                    />
                  ) : null}
                  {canMarkJobsiteDelivery ? (
                    <VendorOrderIconAction
                      label="Jobsite Delivery"
                      icon={Truck}
                      tone="pink"
                      onClick={handleMarkDeliveryToJobsite}
                      loading={isMarkingDeliveryToJobsite}
                      loadingLabel="Marking..."
                      title={
                        selectedReceiveHasInventoryLines
                          ? 'Jobsite Delivery applies to job orders only. Inventory replenishment uses Receive.'
                          : undefined
                      }
                      disabled={
                        selectedItemsToReceive.size === 0 ||
                        selectedReceiveHasInventoryLines ||
                        allSelectedItemsAreFullyReceived ||
                        isMarkingPickup ||
                        isClearingDeliveryStatus ||
                        isMarkingReceived ||
                        isRevertingReceived ||
                        isCancellingReceiveOrders
                      }
                    />
                  ) : null}
                  {canClearDeliveryStatus ? (
                    <VendorOrderIconAction
                      label="Clear Status"
                      icon={Eraser}
                      tone="slate"
                      title={
                        selectedReceiveHasInventoryLines
                          ? 'Clear Status applies to job orders only.'
                          : 'Clears Pickup, Jobsite Delivery, and Received status (undo if marked by mistake)'
                      }
                      onClick={handleClearDeliveryStatus}
                      loading={isClearingDeliveryStatus}
                      loadingLabel="Clearing..."
                      disabled={
                        selectedItemsToReceive.size === 0 ||
                        selectedReceiveHasInventoryLines ||
                        allSelectedItemsAreFullyReceived ||
                        isMarkingPickup ||
                        isMarkingDeliveryToJobsite ||
                        isMarkingReceived ||
                        isRevertingReceived ||
                        isCancellingReceiveOrders
                      }
                    />
                  ) : null}
                  {allSelectedItemsAreFullyReceived && canRevertReceived ? (
                    <VendorOrderIconAction
                      label="Revert Received"
                      icon={Undo2}
                      tone="amber"
                      title={
                        selectedReceiveHasInventoryLines
                          ? 'Revert Received applies to job orders only.'
                          : 'Revert selected items back to Pick up or Jobsite Delivery (undo Mark Received)'
                      }
                      onClick={handleRevertReceived}
                      loading={isRevertingReceived}
                      loadingLabel="Reverting..."
                      disabled={
                        selectedItemsToReceive.size === 0 ||
                        selectedReceiveHasInventoryLines ||
                        isMarkingPickup ||
                        isMarkingDeliveryToJobsite ||
                        isClearingDeliveryStatus ||
                        isMarkingReceived ||
                        isCancellingReceiveOrders
                      }
                    />
                  ) : !allSelectedItemsAreFullyReceived && canMarkReceived ? (
                    <VendorOrderIconAction
                      label="Received"
                      icon={Check}
                      tone="green"
                      onClick={handleMarkReceived}
                      loading={isMarkingReceived}
                      loadingLabel="Marking..."
                      disabled={
                        selectedItemsToReceive.size === 0 ||
                        isRevertingReceived ||
                        isMarkingPickup ||
                        isMarkingDeliveryToJobsite ||
                        isClearingDeliveryStatus ||
                        isCancellingReceiveOrders
                      }
                    />
                  ) : null}
                </div>
              )}
            </div>

            {/* Tabs */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {canViewToOrderTab ? (
              <VendorOrderTabButton
                tab="pending-to-order"
                isActive={activeTab === 'pending-to-order'}
                count={totalPendingToOrderItems}
                onClick={() => {
                  setActiveTab('pending-to-order');
                  setSelectedItemsToOrder(new Set());
                  setQuantityOrdered(new Map());
                  setManualOtherSelections(new Set());
                  setCustomVendors(new Map());
                }}
              />
              ) : null}
              {canViewPendingOrderUpdates ? (
                <VendorOrderTabButton
                  tab="pending-to-receive"
                  isActive={activeTab === 'pending-to-receive'}
                  count={totalPendingToReceiveItems}
                  onClick={() => {
                    setActiveTab('pending-to-receive');
                    setSelectedItemsToReceive(new Set());
                    setQuantityReceived(new Map());
                    setManualOtherSelections(new Set());
                    setCustomVendors(new Map());
                  }}
                />
              ) : null}
              {canViewOrderHistory ? (
              <VendorOrderTabButton
                tab="order-history"
                isActive={activeTab === 'order-history'}
                count={pastOrders.length}
                onClick={() => {
                  setActiveTab('order-history');
                }}
              />
              ) : null}
              {/* Refresh Button */}
              <button
                onClick={() => {
                  loadAllTabCounts();
                  loadData();
                }}
                disabled={isLoading}
                className="ml-auto px-4 py-2.5 bg-slate-200 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600/80 hover:bg-slate-300 dark:hover:bg-slate-700/70 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                title="Refresh data"
              >
                <svg
                  className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {isLoading ? 'Refreshing...' : 'Refresh'}
              </button>
              {canManageSuppliers ? (
                <button
                  onClick={() => setShowVendorsHubModal(true)}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-all flex items-center gap-2"
                  title="Manage vendors and PO email routing"
                >
                  <Building2 className="w-4 h-4" strokeWidth={2.25} aria-hidden />
                  Vendors
                </button>
              ) : null}
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

        {successMessage && (
          <div className="px-6 pt-4 flex-shrink-0">
            <div
              className={`p-4 rounded-xl shadow-lg text-white ${
                sendResults.some((r) => r.sendStatus === 'FAILED') && sendResults.every((r) => r.sendStatus === 'FAILED')
                  ? 'bg-red-500'
                  : sendResults.some((r) => r.sendStatus === 'FAILED')
                    ? 'bg-amber-500'
                    : 'bg-green-500'
              }`}
            >
              <p className="font-bold">{successMessage}</p>
              {sendResults.length > 0 && (
                <div className="mt-3 space-y-1 text-sm text-white/90">
                  {sendResults.map((result) => (
                    <p key={`${result.orderNumber}-${result.supplier}`}>
                      {formatVendorDisplay(result.supplier)}: {result.sendStatus === 'SENT' ? 'Sent' : 'Could not send'}
                      {result.sendStatus === 'SENT' && getDisplayPoLabel(result) ? ` (${getDisplayPoLabel(result)})` : ''}
                      {result.sendStatus === 'SENT' && result.fallbackToPurchasing ? ' — emailed to purchasing (vendor PO email not configured)' : ''}
                      {result.sendStatus === 'FAILED' && result.fallbackToPurchasing ? ' — would have gone to purchasing' : ''}
                      {result.sendError ? ` — ${result.sendError}` : ''}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Main Content */}
        <main className="flex-1 flex flex-col overflow-hidden px-6 py-6 bg-gray-50 dark:bg-slate-900 min-h-0">
          <div className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 rounded-xl p-6 sm:p-8 flex flex-col overflow-hidden min-h-0 h-full shadow-sm dark:shadow-none">
            {/* Main Content Section */}
            <div className="flex-1 flex flex-col overflow-hidden min-h-0 space-y-4">
              {activeTab === 'pending-to-order' && canViewToOrderTab && (
                <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                  <div className="flex items-center justify-between mb-4 flex-shrink-0">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      {(() => {
                        const meta = VENDOR_ORDER_TABS['pending-to-order'];
                        const Icon = meta.icon;
                        return (
                          <>
                            <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${meta.stepBadgeClass}`}>
                              <Icon className={`h-4 w-4 ${meta.iconClass}`} strokeWidth={2.25} />
                            </span>
                            {meta.label}
                          </>
                        );
                      })()}
                      <span className="ml-1 text-sm font-normal text-slate-600 dark:text-slate-400">
                        ({totalPendingToOrderItems} items across {filteredPendingToOrderJobs.length} jobs)
                      </span>
                    </h2>
                    
                    {totalPendingToOrderItems > 0 && canEditToOrderRows && (
                      <div className="flex items-center gap-3">
                        <button
                          onClick={allItemsSelectedToOrder() ? deselectAllItemsToOrder : selectAllItemsToOrder}
                          className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
                        >
                          {allItemsSelectedToOrder() ? 'Deselect All' : 'Select All'}
                        </button>
                        <button
                          onClick={openBulkCancelModal}
                          disabled={selectedCancelableCount === 0 || isCancellingOrders || isSending}
                          className="text-sm px-3 py-1.5 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/40 disabled:opacity-50 disabled:cursor-not-allowed"
                          title={selectedItemsToOrder.size > selectedCancelableCount ? `${selectedItemsToOrder.size - selectedCancelableCount} selected item(s) are already in Purchase Orders and cannot be canceled.` : 'Cancel selected order lines'}
                        >
                          Cancel Selected ({selectedCancelableCount})
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="mb-4 flex-shrink-0">
                    <input
                      type="text"
                      value={pendingToOrderSearch}
                      onChange={(e) => setPendingToOrderSearch(e.target.value)}
                      placeholder="search for a job"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {filteredPendingToOrderJobs.length === 0 ? (
                    <div className="bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl p-8 text-center shadow-sm dark:shadow-none">
                      <svg className="w-16 h-16 text-slate-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                      </svg>
                      <p className="text-slate-600 dark:text-slate-400 font-medium">
                        {VENDOR_ORDER_TABS['pending-to-order'].emptyTitle}
                      </p>
                      <p className="text-slate-600 dark:text-slate-500 text-sm mt-1">
                        {isLoadingPendingToOrder
                          ? 'Loading...'
                          : pendingToOrderSearch.trim()
                            ? 'No matching jobs found for your search.'
                            : VENDOR_ORDER_TABS['pending-to-order'].emptyDescription}
                      </p>
                      {!isLoadingPendingToOrder && (
                        <p className="text-slate-600 dark:text-slate-600 text-xs mt-2">
                          {pendingToOrderSearch.trim()
                            ? 'No matching jobs found for your search.'
                            : 'To add items here, go to a job page and click the "Order" button on items that need to be ordered.'}
                        </p>
                      )}
                      {process.env.NODE_ENV === 'development' && !isLoadingPendingToOrder && (
                        <div className="mt-4 p-3 bg-gray-100 dark:bg-slate-900/50 rounded-lg text-left text-xs text-slate-600 dark:text-slate-500">
                          <p className="font-semibold mb-1">Debug Info:</p>
                          <p>Tab: {activeTab}</p>
                          <p>Jobs loaded: {filteredPendingToOrderJobs.length}</p>
                          <p>Total items: {totalPendingToOrderItems}</p>
                          <p>Check browser console for API response details.</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex-1 overflow-y-auto min-h-0 space-y-3">
                      {filteredPendingToOrderJobs.map((job) => {
                        const listForCard = getJobListForCard(job);
                        const isExpanded = !collapsedJobKeys.has(getJobCollapseKey('pending-to-order', job.jobNumber, listForCard));
                        const jobItemKeys = job.items.map((item) => getItemKey(job.jobNumber, item.partNumber, item.listNumber));
                        const allJobItemsSelected = jobItemKeys.every((key) => selectedItemsToOrder.has(key));
                        const someJobItemsSelected = jobItemKeys.some((key) => selectedItemsToOrder.has(key));

                        return (
                          <div
                            key={getJobCardKey(job)}
                            className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 rounded-xl overflow-hidden"
                          >
                            {/* Job Header */}
                            <div
                              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors"
                              onClick={() => toggleJobExpanded('pending-to-order', job.jobNumber, listForCard)}
                            >
                              <input
                                type="checkbox"
                                checked={allJobItemsSelected}
                                ref={(el) => {
                                  if (el) el.indeterminate = someJobItemsSelected && !allJobItemsSelected;
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  toggleJobSelectedToOrder(job);
                                }}
                                disabled={!canEditToOrderRows}
                                className={VENDOR_ORDER_CHECKBOX_LG}
                              />
                              <div className="flex-1">
                                <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
                                  {job.isInventoryReplenishment ? (
                                    <>
                                      {job.jobName}
                                      <span className="px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                        Needs Minimum
                                      </span>
                                    </>
                                  ) : (
                                    job.jobName
                                  )}
                                </div>
                                {!job.isInventoryReplenishment && (
                                  <>
                                    <div className="text-sm text-slate-600 dark:text-slate-400">{job.area || 'No Area'}</div>
                                    <div className="text-xs text-slate-500 dark:text-slate-500 mt-0.5">
                                      List #{getJobListSummary(job.items)} | Job #{job.jobNumber}
                                    </div>
                                  </>
                                )}
                                {job.isInventoryReplenishment && (
                                  <div className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                                    Stock below minimum on hand — standard reorder quantities
                                  </div>
                                )}
                              </div>
                              <span className="text-sm text-slate-600 dark:text-slate-400 bg-gray-100 dark:bg-slate-700/50 px-2 py-1 rounded-lg">
                                {job.items.length} items
                              </span>
                              <svg
                                className={`w-5 h-5 text-slate-600 dark:text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>

                            {/* Job Items */}
                            {isExpanded && (
                              <div className="border-t border-gray-200 dark:border-slate-700/50">
                                <table className="w-full text-sm">
                                  <thead className="bg-gray-100 dark:bg-slate-700/30">
                                    <tr>
                                      <th className="w-10 px-4 py-2"></th>
                                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">List #</th>
                                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Part #</th>
                                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Description</th>
                                      <th className="px-4 py-2 text-center text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">
                                        {job.isInventoryReplenishment ? 'On Hand' : 'Qty Needed'}
                                      </th>
                                      <th className="px-4 py-2 text-center text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Qty to Order</th>
                                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Vendor</th>
                                      <th className="px-4 py-2 text-center text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Status</th>
                                      <th className="px-4 py-2 text-center text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700/30">
                                    {job.items.map((item) => {
                                      const itemKey = getItemKey(job.jobNumber, item.partNumber, item.listNumber);
                                      const isSelected = selectedItemsToOrder.has(itemKey);
                                      const jobRequirement = Math.max(0, item.quantityNeeded ?? 0);
                                      const explicitOrderQty = Math.max(0, item.quantityOrdered ?? 0);
                                      const isInventoryLine = job.isInventoryReplenishment === true;
                                      // Show what was ordered from the job dashboard; fall back to job line total
                                      const quantityNeededDisplay = isInventoryLine
                                        ? (item.onHand ?? 0)
                                        : explicitOrderQty > 0 ? explicitOrderQty : jobRequirement;
                                      const quantityNeededTitle = isInventoryLine
                                        ? `Min on hand: ${item.minOnHand ?? '—'} | Order min: ${item.orderMinimum ?? '—'}`
                                        : explicitOrderQty > 0 && explicitOrderQty !== jobRequirement
                                          ? `Job requires ${jobRequirement} total for this line`
                                          : undefined;
                                      // Remaining left to order (e.g. 14 after 20 already in PO) — used for "Qty to Order" default/max only
                                      const remainingToOrder = Math.max(
                                        0,
                                        item.remainingToOrder ??
                                          getRemainingQty({
                                            needed: item.quantityNeeded,
                                            fab: item.quantityFab,
                                            shop: item.quantityPulled,
                                            preorder: item.quantityPreordered ?? 0,
                                            vendor: item.quantityReceivedFromOrder ?? 0,
                                          })
                                      );
                                      const currentQtyOrdered = quantityOrdered.get(itemKey) ?? remainingToOrder;
                                      const currentSupplier = getCurrentSupplier(job.jobNumber, item.partNumber, item.vendor, item.listNumber);

                                      return (
                                        <tr
                                          key={`${item.listNumber || ''}-${item.partNumber}`}
                                          className={`hover:bg-gray-50 dark:hover:bg-slate-700/20 transition-colors ${isSelected ? 'bg-blue-50 dark:bg-blue-500/10' : ''}`}
                                        >
                                          <td className="px-4 py-2">
                                            <div className="flex items-center justify-center">
                                            <input
                                              type="checkbox"
                                              checked={isSelected}
                                              onChange={() => toggleItemSelectedToOrder(job.jobNumber, item.partNumber, item.listNumber)}
                                              disabled={!canEditToOrderRows}
                                              className={VENDOR_ORDER_CHECKBOX}
                                            />
                                            </div>
                                          </td>
                                          <td className="px-4 py-2 text-slate-700 dark:text-slate-300">{item.listNumber || '1'}</td>
                                          <td className="px-4 py-2 font-mono text-slate-700 dark:text-slate-300">{item.partNumber}</td>
                                          <td className="px-4 py-2 text-slate-600 dark:text-slate-400 truncate max-w-xs">{item.description || '-'}</td>
                                          <td
                                            className="px-4 py-2 text-center text-slate-700 dark:text-slate-300 tabular-nums"
                                            title={quantityNeededTitle}
                                          >
                                            {quantityNeededDisplay}
                                          </td>
                                          <td className="px-4 py-2 text-center">
                                            <div className="flex justify-center">
                                              <input
                                                type="number"
                                                min="0"
                                                value={currentQtyOrdered}
                                                readOnly={!canEditToOrderRows}
                                                onChange={(e) => {
                                                  if (!canEditToOrderRows) return;
                                                  const value = e.target.value === '' ? 0 : parseInt(e.target.value, 10);
                                                  if (!isNaN(value) && value >= 0) {
                                                    setQuantityOrdered((prev) => {
                                                      const newMap = new Map(prev);
                                                      newMap.set(itemKey, value);
                                                      return newMap;
                                                    });
                                                  }
                                                }}
                                                onClick={(e) => e.stopPropagation()}
                                                className="w-24 px-2 py-1.5 text-center text-slate-900 dark:text-slate-300 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                                                title={
                                                  remainingToOrder > 0
                                                    ? `Suggested: ${remainingToOrder}. Enter any quantity to order.`
                                                    : 'Enter quantity to order'
                                                }
                                              />
                                            </div>
                                          </td>
                                          <td className="px-4 py-2 text-slate-600 dark:text-slate-400">
                                            <div className="space-y-2">
                                              <select
                                                value={getVendorDropdownValue(itemKey, currentSupplier)}
                                                onChange={(e) =>
                                                  handleVendorDropdownChange(
                                                    job.jobNumber,
                                                    item.partNumber,
                                                    item.listNumber,
                                                    e.target.value,
                                                    currentSupplier
                                                  )
                                                }
                                                onClick={(e) => e.stopPropagation()}
                                                className="w-52 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-300 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                                                disabled={!canEditToOrderRows || isLoadingVendors}
                                              >
                                                <option value="">- Select Vendor -</option>
                                                {allVendors.map((vendorOption) => (
                                                  <option key={vendorOption} value={vendorOption}>
                                                    {formatVendorDisplay(vendorOption)}
                                                  </option>
                                                ))}
                                                <option value="Other">Other</option>
                                              </select>
                                              {getVendorDropdownValue(itemKey, currentSupplier) === 'Other' && (
                                                <input
                                                  type="text"
                                                  value={getCustomVendorValue(itemKey, currentSupplier)}
                                                  onChange={(e) =>
                                                    handleCustomVendorChange(job.jobNumber, item.partNumber, e.target.value, item.listNumber)
                                                  }
                                                  onClick={(e) => e.stopPropagation()}
                                                  readOnly={!canEditToOrderRows}
                                                  className="w-52 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-300 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                                                  placeholder="Enter vendor name"
                                                />
                                              )}
                                            </div>
                                          </td>
                                          <td className="px-4 py-2 text-center">
                                            {isInventoryLine ? (
                                              <span className="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700/50">
                                                Needs Minimum
                                              </span>
                                            ) : (
                                              <span className="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-lg bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 border border-blue-300 dark:border-blue-500/30">
                                                Ready
                                              </span>
                                            )}
                                          </td>
                                          <td className="px-4 py-2 text-center">
                                            {isInventoryLine ? (
                                              <span className="text-xs text-slate-500 dark:text-slate-400">—</span>
                                            ) : item.canCancel !== false && canEditToOrderRows ? (
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  openSingleCancelModal(job.jobNumber, item);
                                                }}
                                                disabled={isCancellingOrders || isSending}
                                                className="px-3 py-1.5 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                              >
                                                Cancel Order
                                              </button>
                                            ) : (
                                              <span
                                                title={item.cancelBlockReason || 'Already sent in Purchase Order'}
                                                className="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-lg bg-slate-200 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300"
                                              >
                                                In PO
                                              </span>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'pending-to-receive' && (
                <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                  <div className="flex items-center justify-between mb-4 flex-shrink-0">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      {(() => {
                        const meta = VENDOR_ORDER_TABS['pending-to-receive'];
                        const Icon = meta.icon;
                        return (
                          <>
                            <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${meta.stepBadgeClass}`}>
                              <Icon className={`h-4 w-4 ${meta.iconClass}`} strokeWidth={2.25} />
                            </span>
                            {meta.label}
                          </>
                        );
                      })()}
                      <span className="ml-1 text-sm font-normal text-slate-600 dark:text-slate-400">
                        ({totalPendingToReceiveItems} items across {filteredPendingToReceiveJobs.length} jobs)
                      </span>
                    </h2>
                    
                    {totalPendingToReceiveItems > 0 && (
                      <button
                        onClick={allItemsSelectedToReceive() ? deselectAllItemsToReceive : selectAllItemsToReceive}
                        className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
                      >
                        {allItemsSelectedToReceive() ? 'Deselect All' : 'Select All'}
                      </button>
                    )}
                  </div>

                  <div className="mb-4 flex-shrink-0">
                    <input
                      type="text"
                      value={pendingToReceiveSearch}
                      onChange={(e) => setPendingToReceiveSearch(e.target.value)}
                      placeholder="search for a job"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>

                  {filteredPendingToReceiveJobs.length === 0 ? (
                    <div className="bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl p-8 text-center shadow-sm dark:shadow-none">
                      <svg className="w-16 h-16 text-slate-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-slate-600 dark:text-slate-400 font-medium">
                        {VENDOR_ORDER_TABS['pending-to-receive'].emptyTitle}
                      </p>
                      <p className="text-slate-600 dark:text-slate-500 text-sm mt-1">
                        {pendingToReceiveSearch.trim()
                          ? 'No matching jobs found for your search'
                          : VENDOR_ORDER_TABS['pending-to-receive'].emptyDescription}
                      </p>
                    </div>
                  ) : (
                    <div className="flex-1 overflow-y-auto min-h-0 space-y-3">
                      {filteredPendingToReceiveJobs.map((job) => {
                        const listForCard = getJobListForCard(job);
                        const isExpanded = !collapsedJobKeys.has(getJobCollapseKey('pending-to-receive', job.jobNumber, listForCard));
                        const jobItemKeys = job.items.map((item) => getItemKey(job.jobNumber, item.partNumber, item.listNumber));
                        const allJobItemsSelected = jobItemKeys.every((key) => selectedItemsToReceive.has(key));
                        const someJobItemsSelected = jobItemKeys.some((key) => selectedItemsToReceive.has(key));

                        return (
                          <div
                            key={getJobCardKey(job)}
                            className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 rounded-xl overflow-hidden"
                          >
                            {/* Job Header */}
                            <div
                              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors"
                              onClick={() => toggleJobExpanded('pending-to-receive', job.jobNumber, listForCard)}
                            >
                              <input
                                type="checkbox"
                                checked={allJobItemsSelected}
                                ref={(el) => {
                                  if (el) el.indeterminate = someJobItemsSelected && !allJobItemsSelected;
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  toggleJobSelectedToReceive(job);
                                }}
                                className={VENDOR_ORDER_CHECKBOX_GREEN_LG}
                              />
                              <div className="flex-1">
                                <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
                                  {job.isInventoryReplenishment ? (
                                    <>
                                      {job.jobName}
                                      <span className="px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                        Inventory Replenishment
                                      </span>
                                    </>
                                  ) : (
                                    job.jobName
                                  )}
                                </div>
                                {!job.isInventoryReplenishment && (
                                  <>
                                    <div className="text-sm text-slate-600 dark:text-slate-400">{job.area || 'No Area'}</div>
                                    <div className="text-xs text-slate-500 dark:text-slate-500 mt-0.5">
                                      List #{getJobListSummary(job.items)} | Job #{job.jobNumber}
                                    </div>
                                  </>
                                )}
                                {job.isInventoryReplenishment && (
                                  <div className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                                    Receive to increase on-hand inventory (STOCK_IN)
                                  </div>
                                )}
                              </div>
                              <span className="text-sm text-slate-600 dark:text-slate-400 bg-gray-100 dark:bg-slate-700/50 px-2 py-1 rounded-lg">
                                {job.items.length} items
                              </span>
                              <svg
                                className={`w-5 h-5 text-slate-600 dark:text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>

                            {/* Job Items */}
                            {isExpanded && (
                              <div className="border-t border-gray-200 dark:border-slate-700/50 overflow-x-hidden">
                                <table className="w-full text-sm table-fixed">
                                  <PendingToReceiveItemsColGroup />
                                  <thead className="bg-gray-100 dark:bg-slate-700/30">
                                    <tr>
                                      <th className="px-3 py-2"></th>
                                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">List #</th>
                                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Part #</th>
                                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Description</th>
                                      <th className="px-3 py-2 text-center text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Qty Ordered</th>
                                      <th className="px-3 py-2 text-center text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Qty Received</th>
                                      <th className="px-3 py-2 text-center text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Status</th>
                                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Vendor</th>
                                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Order #</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700/30">
                                    {job.items.map((item) => {
                                      const itemKey = getItemKey(job.jobNumber, item.partNumber, item.listNumber);
                                      const isSelected = selectedItemsToReceive.has(itemKey);
                                      const primaryOrder = item.purchaseOrders[0]; // Show most recent order
                                      // Use quantityOrdered from PurchaseOrder (source of truth), fallback to calculated if null
                                      const quantityOrdered = item.quantityOrdered !== null && item.quantityOrdered !== undefined
                                        ? item.quantityOrdered
                                        : getRemainingQty({
                                            needed: item.quantityNeeded,
                                            fab: item.quantityFab,
                                            shop: item.quantityPulled,
                                            preorder: item.quantityPreordered ?? 0,
                                            vendor:
                                              item.quantityReceived ??
                                              item.quantityReceivedFromOrder ??
                                              0,
                                          });
                                      // Use current received quantity from state, or from item if > 0, or default to ordered qty
                                      const persistedReceivedQty = Math.max(
                                        0,
                                        Number(item.quantityReceived ?? item.quantityReceivedFromOrder ?? 0),
                                      );
                                      const effectiveReceivedQty = quantityReceived.has(itemKey)
                                        ? Number(quantityReceived.get(itemKey) ?? persistedReceivedQty)
                                        : persistedReceivedQty;
                                      const isInventoryReceiveLine = job.isInventoryReplenishment === true;
                                      const currentQtyReceived = isInventoryReceiveLine
                                        ? effectiveReceivedQty
                                        : effectiveReceivedQty > 0
                                          ? effectiveReceivedQty
                                          : quantityOrdered;
                                      const isPartialReceive =
                                        !item.isFullyReceived &&
                                        quantityOrdered > 0 &&
                                        effectiveReceivedQty > 0 &&
                                        effectiveReceivedQty < quantityOrdered;
                                      const hasBothTransitFlags = item.supplierDeliveryToJobsite === true && item.pickupFromSupplier === true;
                                      const quantityReadOnly = item.isFullyReceived || !canMarkReceived;

                                      if (hasBothTransitFlags && process.env.NODE_ENV === 'development') {
                                        console.warn(
                                          `[vendor orders] Both supplierDeliveryToJobsite and pickupFromSupplier are true for ${job.jobNumber}::${item.listNumber || ''}::${item.partNumber}. Showing Delivery badge.`,
                                        );
                                      }

                                      return (
                                        <tr
                                          key={`${item.listNumber || ''}-${item.partNumber}`}
                                          className={`hover:bg-gray-50 dark:hover:bg-slate-700/20 transition-colors ${isSelected ? 'bg-green-50 dark:bg-green-500/10' : ''}`}
                                        >
                                          <td className="px-3 py-2">
                                            <div className="flex items-center justify-center">
                                            <input
                                              type="checkbox"
                                              checked={isSelected}
                                              onChange={() => toggleItemSelectedToReceive(job.jobNumber, item.partNumber, item.listNumber)}
                                              className={VENDOR_ORDER_CHECKBOX_GREEN}
                                            />
                                            </div>
                                          </td>
                                          <td className="px-3 py-2 text-slate-600 dark:text-slate-400 tabular-nums">{item.listNumber || '-'}</td>
                                          <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-300">{item.partNumber}</td>
                                          <td className="px-3 py-2 text-slate-600 dark:text-slate-400 truncate">{item.description || '-'}</td>
                                          <td className="px-3 py-2 text-center text-slate-700 dark:text-slate-300 tabular-nums">
                                            {quantityOrdered}
                                          </td>
                                          <td className="px-3 py-2 text-center">
                                            <input
                                              type="number"
                                              min={quantityReadOnly ? persistedReceivedQty : 0}
                                              max={quantityOrdered || undefined}
                                              value={currentQtyReceived}
                                              readOnly={quantityReadOnly}
                                              onChange={(e) => {
                                                if (quantityReadOnly) return;
                                                const emptyValue = isInventoryReceiveLine ? 0 : quantityOrdered;
                                                const inputValue = e.target.value === '' ? emptyValue : parseInt(e.target.value, 10);
                                                if (!isNaN(inputValue) && inputValue >= 0) {
                                                  const minReceived = persistedReceivedQty;
                                                  const cappedValue = quantityOrdered !== null && quantityOrdered !== undefined
                                                    ? Math.min(Math.max(inputValue, minReceived), quantityOrdered)
                                                    : Math.max(inputValue, minReceived);
                                                  setQuantityReceived((prev) => {
                                                    const newMap = new Map(prev);
                                                    newMap.set(itemKey, cappedValue);
                                                    return newMap;
                                                  });
                                                }
                                              }}
                                              onBlur={(e) => {
                                                if (quantityReadOnly) return;
                                                const inputValue = parseInt(e.target.value) || 0;
                                                if (quantityOrdered !== null && quantityOrdered !== undefined && inputValue > quantityOrdered) {
                                                  setQuantityReceived((prev) => {
                                                    const newMap = new Map(prev);
                                                    newMap.set(itemKey, quantityOrdered);
                                                    return newMap;
                                                  });
                                                }
                                              }}
                                              onClick={(e) => e.stopPropagation()}
                                              className={`w-14 mx-auto shrink-0 px-2 py-1 text-center text-sm tabular-nums text-slate-900 dark:text-slate-300 border rounded-md focus:outline-none focus:ring-2 ${
                                                isPartialReceive
                                                  ? "border-amber-400 bg-amber-50/80 ring-amber-400/40 focus:border-amber-500 focus:ring-amber-500/40 dark:border-amber-500/60 dark:bg-amber-950/30 dark:text-amber-50"
                                                  : "border-gray-300 dark:border-slate-600 focus:border-green-500 focus:ring-green-500"
                                              } ${quantityReadOnly ? "bg-slate-100 dark:bg-slate-800 cursor-not-allowed" : "bg-white dark:bg-slate-700/50"}`}
                                              title={
                                                item.isFullyReceived
                                                  ? 'Received quantity cannot be changed. Use Revert Received to undo.'
                                                  : canMarkReceived
                                                    ? `Enter total quantity received (max: ${quantityOrdered || 'N/A'})`
                                                    : 'Mark Received permission is required to edit received quantities.'
                                              }
                                            />
                                          </td>
                                          <td className="px-3 py-2 text-center">
                                            <div className="flex flex-wrap items-center justify-center gap-1">
                                              {isPartialReceive ? (
                                                <span
                                                  className="inline-flex shrink-0 items-center rounded-md border border-amber-400/70 bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold tabular-nums whitespace-nowrap text-amber-950 ring-1 ring-amber-400/30 dark:bg-amber-500/20 dark:text-amber-100"
                                                  title={`${quantityOrdered - effectiveReceivedQty} still pending receive`}
                                                >
                                                  Partial {effectiveReceivedQty}/{quantityOrdered}
                                                </span>
                                              ) : null}
                                              {item.isFullyReceived ? (
                                                <span className="shrink-0 px-2 py-0.5 text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 rounded whitespace-nowrap">
                                                  Received
                                                </span>
                                              ) : null}
                                              {!item.isFullyReceived && !isPartialReceive && item.supplierDeliveryToJobsite ? (
                                                <span className="shrink-0 px-2 py-0.5 text-[10px] font-semibold bg-pink-100 dark:bg-pink-500/20 text-pink-700 dark:text-pink-300 rounded whitespace-nowrap">
                                                  Delivery
                                                </span>
                                              ) : !item.isFullyReceived && !isPartialReceive && item.pickupFromSupplier ? (
                                                <span className="shrink-0 px-2 py-0.5 text-[10px] font-semibold bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300 rounded whitespace-nowrap">
                                                  Pickup
                                                </span>
                                              ) : !item.isFullyReceived && !isPartialReceive && job.isInventoryReplenishment ? (
                                                <span className="shrink-0 px-2 py-0.5 text-[10px] font-semibold bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300 rounded whitespace-nowrap">
                                                  On Order
                                                </span>
                                              ) : null}
                                            </div>
                                          </td>
                                          <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                                            <span className="truncate">{item.vendor || '-'}</span>
                                          </td>
                                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                                            {item.purchaseOrders.length > 0 ? (
                                              <div className="min-w-0">
                                                <span className="text-xs font-semibold whitespace-nowrap tabular-nums">
                                                  {getDisplayPoLabel(primaryOrder)}
                                                </span>
                                                {item.purchaseOrders.length > 1 ? (
                                                  <span className="block text-[10px] text-slate-500 dark:text-slate-500">
                                                    +{item.purchaseOrders.length - 1} more
                                                  </span>
                                                ) : null}
                                              </div>
                                            ) : (
                                              <span className="text-slate-500 dark:text-slate-500">—</span>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'order-history' && canViewOrderHistory && (
                <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                  <div className="flex items-center justify-between mb-4 flex-shrink-0">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      {(() => {
                        const meta = VENDOR_ORDER_TABS['order-history'];
                        const Icon = meta.icon;
                        return (
                          <>
                            <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${meta.stepBadgeClass}`}>
                              <Icon className={`h-4 w-4 ${meta.iconClass}`} strokeWidth={2.25} />
                            </span>
                            {meta.label}
                          </>
                        );
                      })()}
                      <span className="ml-1 text-sm font-normal text-slate-600 dark:text-slate-400">
                        ({filteredPastOrders.length} orders)
                      </span>
                    </h2>
                  </div>

                  <div className="mb-4 flex-shrink-0">
                    <input
                      type="text"
                      value={orderHistorySearch}
                      onChange={(e) => setOrderHistorySearch(e.target.value)}
                      placeholder="Search job, list, name, or part"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {filteredPastOrders.length === 0 ? (
                    <div className="bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl p-8 text-center shadow-sm dark:shadow-none">
                      <svg className="w-16 h-16 text-slate-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                      <p className="text-slate-600 dark:text-slate-400 font-medium">
                        {VENDOR_ORDER_TABS['order-history'].emptyTitle}
                      </p>
                      <p className="text-slate-600 dark:text-slate-500 text-sm mt-1">
                        {orderHistorySearch.trim()
                          ? 'No matching orders found for your search'
                          : VENDOR_ORDER_TABS['order-history'].emptyDescription}
                      </p>
                    </div>
                  ) : (
                    <div className="flex-1 overflow-y-auto min-h-0 space-y-3">
                      {filteredPastOrders.map((order) => {
                        const isExpanded = expandedOrders.has(order.id);
                        const sentDate = new Date(order.sentAt);

                        return (
                          <div
                            key={order.id}
                            className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 rounded-xl overflow-hidden"
                          >
                            {/* Order Header */}
                            <div
                              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors"
                              onClick={() => toggleOrderExpanded(order.id)}
                            >
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-slate-900 dark:text-white">{getDisplayPoLabel(order)}</span>
                                  <span className="text-slate-600 dark:text-slate-400 text-sm">
                                    {formatDateInAppTimeZone(sentDate, {
                                      year: 'numeric',
                                      month: 'numeric',
                                      day: 'numeric',
                                    })}{' '}
                                    {formatDateInAppTimeZone(sentDate, {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </span>
                                  {order.supplier && (
                                    <span className="px-2 py-0.5 text-xs rounded-lg bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400">
                                      {order.supplier}
                                    </span>
                                  )}
                                  {order.sendStatus && (
                                    <span className={`px-2 py-0.5 text-xs rounded-lg ${order.sendStatus === 'SENT' ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400'}`}>
                                      {order.sendStatus}
                                    </span>
                                  )}
                                </div>
                                <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                                  Sent by {order.sentBy} • {order.itemCount} items • {order.jobCount} job{order.jobCount !== 1 ? 's' : ''}
                                  {order.sendError ? ` • ${order.sendError}` : ''}
                                </div>
                              </div>
                              {canDeleteOrderHistory ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openDeleteOrderModal(order);
                                }}
                                disabled={isDeletingOrder}
                                title="Delete order and unpull parts"
                                className="flex-shrink-0 p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                              ) : null}
                              <svg
                                className={`w-5 h-5 text-slate-600 dark:text-slate-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>

                            {/* Order Items */}
                            {isExpanded && (
                              <div className="border-t border-gray-200 dark:border-slate-700/50">
                                <table className="w-full text-sm">
                                  <thead className="bg-gray-100 dark:bg-slate-700/30">
                                    <tr>
                                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Job #</th>
                                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">List #</th>
                                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Part #</th>
                                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Description</th>
                                      <th className="px-4 py-2 text-center text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Qty</th>
                                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Vendor</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700/30">
                                    {order.items.map((item, index) => (
                                      <tr
                                        key={`${item.jobNumber}-${String(item.listNumber ?? '').trim() || '1'}-${item.partNumber}-${index}`}
                                        className="hover:bg-gray-50 dark:hover:bg-slate-700/20 transition-colors"
                                      >
                                        <td className="px-4 py-2 font-semibold text-slate-700 dark:text-slate-300">{item.jobNumber}</td>
                                        <td className="px-4 py-2 font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                                          {String(item.listNumber ?? '').trim() || '1'}
                                        </td>
                                        <td className="px-4 py-2 font-mono text-slate-700 dark:text-slate-300">{item.partNumber}</td>
                                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400 truncate max-w-xs">{item.description || '-'}</td>
                                        <td className="px-4 py-2 text-center text-slate-700 dark:text-slate-300">{item.quantityOrdered}</td>
                                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span>{item.vendor || '-'}</span>
                                            {item.cancelled ? (
                                              <span className="px-2 py-0.5 text-[10px] font-semibold bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 rounded">
                                                Cancelled
                                              </span>
                                            ) : null}
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {showCancelReceiveDispositionModal && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          style={{ zIndex: 9999 }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !isCancellingReceiveOrders) {
              closeCancelReceiveModal();
            }
          }}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full border border-gray-200 dark:border-slate-700/50 overflow-hidden"
            style={{ zIndex: 10000 }}
          >
            <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700/50">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">Some Items Are Already Received</h3>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-slate-700 dark:text-slate-300">
                {selectedReceivedCount} of {cancelReceiveTargets.length} selected item(s) are already received. What should we do with the received parts?
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                No cancellation emails will be sent for received items. Choose how to handle the parts:
              </p>
              <div className="space-y-3">
                <label className="flex items-start gap-3 p-4 rounded-xl border border-gray-200 dark:border-slate-600/50 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/30 has-[:checked]:ring-2 has-[:checked]:ring-blue-500 has-[:checked]:border-blue-500">
                  <input
                    type="radio"
                    name="cancelReceiveDisposition"
                    value="sendBackToInventory"
                    checked={cancelReceiveDisposition === 'sendBackToInventory'}
                    onChange={() => setCancelReceiveDisposition('sendBackToInventory')}
                    className="mt-1"
                  />
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-white">Send back to inventory</span>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                      Clear received state and add parts back to on-hand inventory.
                    </p>
                  </div>
                </label>
                <label className="flex items-start gap-3 p-4 rounded-xl border border-gray-200 dark:border-slate-600/50 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/30 has-[:checked]:ring-2 has-[:checked]:ring-blue-500 has-[:checked]:border-blue-500">
                  <input
                    type="radio"
                    name="cancelReceiveDisposition"
                    value="leaveAsIs"
                    checked={cancelReceiveDisposition === 'leaveAsIs'}
                    onChange={() => setCancelReceiveDisposition('leaveAsIs')}
                    className="mt-1"
                  />
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-white">Leave them as is</span>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                      Cancel the order but keep parts allocated to the job (received state stays).
                    </p>
                  </div>
                </label>
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 dark:bg-slate-800/50 border-t border-gray-200 dark:border-slate-700/50 flex gap-3 rounded-b-2xl">
              <button
                onClick={closeCancelReceiveModal}
                disabled={isCancellingReceiveOrders}
                className="flex-1 px-4 py-2.5 bg-gray-200 dark:bg-slate-700/50 hover:bg-gray-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Back
              </button>
              <button
                onClick={() => handleConfirmCancelReceiveOrders(cancelReceiveDisposition)}
                disabled={isCancellingReceiveOrders || cancelReceiveTargets.length === 0}
                className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isCancellingReceiveOrders ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Processing...
                  </>
                ) : (
                  'Yes, Cancel'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCancelReceiveModal && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          style={{ zIndex: 9999 }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !isCancellingReceiveOrders) {
              closeCancelReceiveModal();
            }
          }}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] border border-gray-200 dark:border-slate-700/50 overflow-hidden"
            style={{ zIndex: 10000 }}
          >
            <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700/50">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">Cancel Selected Orders?</h3>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto max-h-[65vh]">
              <p className="text-slate-700 dark:text-slate-300">
                This will cancel outstanding order intent for the selected line items and immediately email cancellation notices to the recipients below.
              </p>
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700/50 rounded-xl p-3 text-sm text-yellow-800 dark:text-yellow-200">
                Warning: cancellation emails will be sent right away to the listed recipients.
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-600/50 rounded-xl p-4">
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  Selected line items: <span className="font-semibold">{cancelReceiveTargets.length}</span>
                </p>
              </div>

              <div className="space-y-3">
                {cancelReceiveRecipientGroups.length === 0 ? (
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    No mapped purchase-order recipients found. The backend will fallback to purchasing if needed.
                  </p>
                ) : (
                  cancelReceiveRecipientGroups.map((group) => (
                    <div key={`${group.orderId}-${group.orderNumber}`} className="border border-gray-200 dark:border-slate-700/50 rounded-xl p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-slate-900 dark:text-white">
                          {group.orderNumber}
                          {group.supplier ? ` - ${group.supplier}` : ''}
                        </p>
                        <span className="text-xs text-slate-600 dark:text-slate-400">{group.itemCount} selected line(s)</span>
                      </div>
                      <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                        To: {group.to.length > 0 ? group.to.join(', ') : '-'}
                      </p>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                        CC: {group.cc.length > 0 ? group.cc.join(', ') : '-'}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 dark:bg-slate-800/50 border-t border-gray-200 dark:border-slate-700/50 flex gap-3 rounded-b-2xl">
              <button
                onClick={closeCancelReceiveModal}
                disabled={isCancellingReceiveOrders}
                className="flex-1 px-4 py-2.5 bg-gray-200 dark:bg-slate-700/50 hover:bg-gray-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Back
              </button>
              <button
                onClick={() => handleConfirmCancelReceiveOrders()}
                disabled={isCancellingReceiveOrders || cancelReceiveTargets.length === 0}
                className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isCancellingReceiveOrders ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Sending...
                  </>
                ) : (
                  'Yes, Cancel and Send Emails'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReviewModal && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          style={{ zIndex: 9999 }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSending) {
              setShowReviewModal(false);
            }
          }}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-6xl w-full max-h-[90vh] border border-gray-200 dark:border-slate-700/50 overflow-hidden"
            style={{ zIndex: 10000 }}
          >
            <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700/50 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Review Supplier Orders</h2>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                  {selectedOrderItemsForReview.length} selected item(s) across {reviewGroups.length} supplier group(s)
                </p>
              </div>
              <button
                onClick={() => setShowReviewModal(false)}
                className="p-2 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700/50"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[65vh] space-y-4">
              {reviewGroupsNeedingSetup > 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                  {reviewGroupsNeedingSetup} supplier group
                  {reviewGroupsNeedingSetup === 1 ? '' : 's'} still need PO email setup. Orders will
                  fall back to purchasing until vendor emails are configured in Vendors.
                </div>
              ) : null}
              {reviewGroups.map((group) => (
                <div key={group.supplierKey} className="border border-gray-200 dark:border-slate-700/50 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 dark:bg-slate-700/30 flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-bold text-slate-900 dark:text-white">{group.supplierName}</h3>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                        To: {group.toEmails.join(', ')} | CC: {group.ccEmails.join(', ')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {group.fallbackToPurchasing && (
                        <span className="px-2 py-1 text-xs font-semibold bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 rounded-lg">
                          Needs setup
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => copySupplierCsv(group.supplierName, group.items)}
                        className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                      >
                        Copy CSV
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-100 dark:bg-slate-700/40">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Part #</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Description</th>
                          <th className="px-3 py-2 text-center text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Qty</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Job #</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-slate-700/30">
                        {group.items.map((item) => (
                          <tr key={`${item.jobNumber}-${item.partNumber}`} className="hover:bg-gray-50 dark:hover:bg-slate-700/20">
                            <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-300">{item.partNumber}</td>
                            <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{item.description || '-'}</td>
                            <td className="px-3 py-2 text-center text-slate-700 dark:text-slate-300">{item.quantityOrdered}</td>
                            <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{item.jobNumber}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 dark:border-slate-700/50 flex justify-end gap-3">
              <button
                onClick={() => setShowReviewModal(false)}
                disabled={isSending}
                className="px-4 py-2.5 bg-gray-200 dark:bg-slate-700/50 hover:bg-gray-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-semibold transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSendOrder}
                disabled={isSending || selectedOrderItemsForReview.length === 0}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isSending ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Sending...
                  </>
                ) : (
                  <>Send Supplier Emails</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCancelOrderModal && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          style={{ zIndex: 9999 }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !isCancellingOrders) {
              closeCancelOrderModal();
            }
          }}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-lg w-full border border-gray-200 dark:border-slate-700/50"
            style={{ zIndex: 10000 }}
          >
            <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700/50">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">Cancel Order</h3>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-slate-700 dark:text-slate-300">
                Are you sure you want to cancel this order? The part will return to un-ordered status.
              </p>
              {cancelOrderMode === 'bulk' && (
                <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-600/50 rounded-xl p-4 space-y-1">
                  <p className="text-sm text-slate-700 dark:text-slate-300">
                    {cancelOrderTargets.length} selected item(s) will be canceled.
                  </p>
                  {cancelOrderBlockedCount > 0 && (
                    <p className="text-sm text-yellow-700 dark:text-yellow-400">
                      {cancelOrderBlockedCount} selected item(s) are already in Purchase Orders and will be skipped.
                    </p>
                  )}
                </div>
              )}
              {cancelOrderMode === 'single' && cancelOrderTargets[0] && (
                <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-600/50 rounded-xl p-4">
                  <p className="text-sm text-slate-700 dark:text-slate-300">
                    {cancelOrderTargets[0].jobNumber} / {cancelOrderTargets[0].listNumber || '1'} / {cancelOrderTargets[0].partNumber}
                  </p>
                </div>
              )}
            </div>
            <div className="px-6 py-4 bg-gray-50 dark:bg-slate-800/50 border-t border-gray-200 dark:border-slate-700/50 flex gap-3 rounded-b-2xl">
              <button
                onClick={closeCancelOrderModal}
                disabled={isCancellingOrders}
                className="flex-1 px-4 py-2.5 bg-gray-200 dark:bg-slate-700/50 hover:bg-gray-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Back
              </button>
              <button
                onClick={handleConfirmCancelOrders}
                disabled={isCancellingOrders || cancelOrderTargets.length === 0}
                className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isCancellingOrders ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Canceling...
                  </>
                ) : (
                  'Yes, Cancel Order'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <VendorsHubModal
        isOpen={showVendorsHubModal}
        onClose={() => {
          setShowVendorsHubModal(false);
          void loadUnifiedVendors();
          void reloadDropdownVendors();
        }}
      />

      {/* Delete Order History Confirmation Modal */}
      {showDeleteOrderModal && orderToDelete && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          style={{ zIndex: 9999 }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !isDeletingOrder) {
              closeDeleteOrderModal();
            }
          }}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full border border-gray-200 dark:border-slate-700/50 relative"
            style={{ zIndex: 10000 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700/50">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                Delete Order History?
              </h3>
            </div>
            <div className="p-6 space-y-4">
              {isLoadingDeleteOrderSummary ? (
                <div className="flex items-center gap-3 text-slate-700 dark:text-slate-300">
                  <div className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>
                  <span>Checking received parts...</span>
                </div>
              ) : deleteOrderReceivedSummary?.hasReceivedParts ? (
                <div className="space-y-3">
                  <p className="text-slate-700 dark:text-slate-300">
                    Warning: this order has parts marked as received. Choose whether deleting this order should add them back to inventory.
                  </p>
                  <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700/50 rounded-xl p-3">
                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                      Received lines: {deleteOrderReceivedSummary.receivedPartLines} • Total received qty: {deleteOrderReceivedSummary.totalReceivedQuantity}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-slate-700 dark:text-slate-300">
                  This will delete this purchase order. No received parts were found for this order.
                </p>
              )}
              <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-600/50 rounded-xl p-4 space-y-2">
                <div>
                  <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">Order:</span>
                  <span className="ml-2 font-bold text-slate-900 dark:text-white">{getDisplayPoLabel(orderToDelete)}</span>
                </div>
                <div>
                  <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">Sent:</span>
                  <span className="ml-2 text-sm text-slate-900 dark:text-white">
                    {formatDateInAppTimeZone(orderToDelete.sentAt)} by {orderToDelete.sentBy}
                  </span>
                </div>
                <div>
                  <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">Items:</span>
                  <span className="ml-2 text-sm text-slate-900 dark:text-white">{orderToDelete.itemCount} part(s)</span>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 dark:bg-slate-800/50 border-t border-gray-200 dark:border-slate-700/50 flex gap-3 rounded-b-2xl">
              <button
                onClick={closeDeleteOrderModal}
                disabled={isDeletingOrder || isLoadingDeleteOrderSummary}
                className="flex-1 px-4 py-2.5 bg-gray-200 dark:bg-slate-700/50 hover:bg-gray-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              {deleteOrderReceivedSummary?.hasReceivedParts ? (
                <>
                  <button
                    onClick={() => handleConfirmDeleteOrder(false)}
                    disabled={isDeletingOrder || isLoadingDeleteOrderSummary}
                    className="flex-1 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-semibold transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isDeletingOrder ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Deleting...
                      </>
                    ) : (
                      'Delete, Do Not Add'
                    )}
                  </button>
                  <button
                    onClick={() => handleConfirmDeleteOrder(true)}
                    disabled={isDeletingOrder || isLoadingDeleteOrderSummary}
                    className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isDeletingOrder ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Deleting...
                      </>
                    ) : (
                      'Delete + Add Inventory'
                    )}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => handleConfirmDeleteOrder(true)}
                  disabled={isDeletingOrder || isLoadingDeleteOrderSummary}
                  className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isDeletingOrder ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Deleting...
                    </>
                  ) : (
                    'Yes, Delete Order'
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
