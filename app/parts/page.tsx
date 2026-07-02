'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import DashboardSidebar from '@/components/DashboardSidebar';
import DashboardBootstrapShell, {
  useAppBootstrap,
  DashboardContentSkeleton,
} from '@/components/DashboardBootstrapShell';
import AccessDeniedOverlay from '@/components/AccessDeniedOverlay';
import AddPartModal from '@/components/AddPartModal';
import AdjustQuantityModal from '@/components/AdjustQuantityModal';
import EditPartModal from '@/components/EditPartModal';
import { formatDateInAppTimeZone } from '@/lib/timezone';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { permissionLoadingFallback } from '@/lib/clientPermissionChecks';

function formatInventoryValue(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

interface Part {
  id: string;
  pn: string;
  nomenclature: string;
  quantity: number;
  reorderPoint: number | null;
  orderMinimum: number | null;
  units: string;
  vendor: string | null;
  altPN?: string | null;
  vendorPartID?: string | null;
  cost: number;
  updatedAt: string;
}

function isPartLowStock(part: Part): boolean {
  const minOnHand = Number(part.reorderPoint ?? 0);
  const orderMin = Number(part.orderMinimum ?? 0);
  if (minOnHand <= 0 || orderMin <= 0) return false;
  return part.quantity <= minOnHand;
}

function getSuggestedReorderQty(part: Part): number | null {
  if (!isPartLowStock(part)) return null;
  const orderMin = Number(part.orderMinimum ?? 0);
  return orderMin > 0 ? orderMin : null;
}

interface InventoryMovement {
  id: string;
  partId: string;
  part: {
    id: string;
    pn: string;
    nomenclature: string;
  };
  actorUserId: string;
  actor: { name: string | null; email: string } | null;
  type: 'PULL' | 'UNPULL' | 'ADJUSTMENT';
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  contextType: string | null;
  contextId: string | null;
  note: string | null;
  createdAt: string;
}

interface PartCostChangeRow {
  id: string;
  partId: string;
  part: { id: string; pn: string; nomenclature: string };
  actorUserId: string | null;
  actor: { name: string | null; email: string } | null;
  costBefore: number | null;
  costAfter: number;
  contextType: string;
  contextId: string | null;
  note: string | null;
  createdAt: string;
}

interface PartInfoDiffRow {
  field: string;
  before: string | null;
  after: string | null;
}

interface PartInfoChangeRow {
  id: string;
  partId: string;
  part: { id: string; pn: string; nomenclature: string };
  actorUserId: string | null;
  actor: { name: string | null; email: string } | null;
  contextType: string;
  contextId: string | null;
  changes: PartInfoDiffRow[];
  note: string | null;
  createdAt: string;
}

interface UnifiedLogEvent {
  kind: 'quantity' | 'cost' | 'profile';
  eventId: string;
  partId: string;
  part: { id: string; pn: string; nomenclature: string };
  actorUserId: string | null;
  actor: { name: string | null; email: string } | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

/** Drop redundant `[MANUAL:CODE] | <label> |` when Source already shows MANUAL. */
function displayMovementNote(note: string | null, contextType: string | null): string {
  const raw = note?.trim();
  if (!raw) return '';
  const ct = contextType?.trim().toUpperCase() || '';
  if (ct === 'MANUAL') {
    const stripped = raw.replace(/^\[MANUAL:[A-Z]+\]\s*\|\s*[^|]+\s*\|\s*/i, '').trim();
    return stripped || raw;
  }
  return raw;
}

function isStockInFromJobMovement(params: {
  type: string | null | undefined;
  contextType: string | null | undefined;
  note: string | null | undefined;
}) {
  const type = params.type?.trim().toUpperCase() || '';
  const contextType = params.contextType?.trim().toUpperCase() || '';
  const note = params.note?.trim() || '';
  return (
    type === 'UNPULL' &&
    contextType === 'JOB' &&
    /^stock in from job\b/i.test(note)
  );
}

function isStockInReversalFromJobMovement(params: {
  type: string | null | undefined;
  contextType: string | null | undefined;
  note: string | null | undefined;
}) {
  const type = params.type?.trim().toUpperCase() || '';
  const contextType = params.contextType?.trim().toUpperCase() || '';
  const note = params.note?.trim() || '';
  return (
    type === 'PULL' &&
    contextType === 'JOB' &&
    /^stock in reversed from job\b/i.test(note)
  );
}

function isStockInDeletedFromJobMovement(params: {
  type: string | null | undefined;
  contextType: string | null | undefined;
  note: string | null | undefined;
}) {
  const type = params.type?.trim().toUpperCase() || '';
  const contextType = params.contextType?.trim().toUpperCase() || '';
  const note = params.note?.trim() || '';
  return (
    type === 'PULL' &&
    contextType === 'JOB' &&
    /^stock in deleted from job\b/i.test(note)
  );
}

function movementTypeLabel(movement: {
  type: string;
  contextType: string | null;
  note: string | null;
}) {
  if (isStockInDeletedFromJobMovement(movement)) return 'STOCK IN DELETED';
  if (isStockInReversalFromJobMovement(movement)) return 'STOCK IN REVERSAL';
  return isStockInFromJobMovement(movement) ? 'STOCK IN' : movement.type;
}

function ContextIdLine({ id, contextUpper }: { id: string; contextUpper: string }) {
  const trimmed = id.trim();
  if (!trimmed) return null;

  if (contextUpper === 'MANUAL' && trimmed.startsWith('manual:')) {
    const parts = trimmed.split(':');
    const ts = parts[parts.length - 1];
    const asNum = Number(ts);
    if (!Number.isNaN(asNum) && ts.length >= 12) {
      const d = new Date(asNum);
      if (!Number.isNaN(d.getTime())) {
        return (
          <p className="text-xs text-slate-600 dark:text-slate-300 tabular-nums" title={trimmed}>
            <span className="text-slate-500 dark:text-slate-400">Recorded </span>
            {d.toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </p>
        );
      }
    }
  }

  const mono =
    trimmed.length > 36 ? `${trimmed.slice(0, 16)}…${trimmed.slice(-12)}` : trimmed;
  return (
    <p
      className="text-[11px] font-mono text-slate-500 dark:text-slate-400 break-all leading-snug"
      title={trimmed}
    >
      {mono}
    </p>
  );
}

/** Source column: human summary first, compact type badge, readable technical ref. */
function MovementContextCell({
  contextType,
  contextId,
}: {
  contextType: string | null;
  contextId: string | null;
}) {
  const ct = contextType?.trim() || '';
  const id = contextId?.trim() || '';
  if (!ct && !id) {
    return <span className="text-slate-400">—</span>;
  }
  const upper = ct.toUpperCase();
  const badgeClass =
    upper === 'MANUAL'
      ? 'bg-violet-600/95 text-white'
      : upper === 'JOB'
        ? 'bg-amber-600/95 text-white'
        : upper === 'ORDER'
          ? 'bg-teal-600/95 text-white'
          : 'bg-slate-500/90 text-white';
  const subtitle =
    upper === 'MANUAL'
      ? 'Inventory correction'
      : upper === 'JOB'
        ? 'Job pull or return'
        : upper === 'ORDER'
          ? 'Order / PO stock return'
          : null;

  return (
    <div className="flex flex-col gap-2 min-w-[11rem] max-w-[20rem]">
      {subtitle ? (
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100 leading-snug">{subtitle}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex shrink-0 rounded px-2 py-0.5 text-[11px] font-bold tracking-wide ${badgeClass}`}
        >
          {upper || '—'}
        </span>
      </div>
      {id ? <ContextIdLine id={id} contextUpper={upper} /> : null}
    </div>
  );
}

/** Catalog cost audit: MANUAL / AUTO / JOB / IMPORT / SYSTEM. */
function CatalogCostContextCell({
  contextType,
  contextId,
}: {
  contextType: string;
  contextId: string | null;
}) {
  const ct = contextType?.trim() || '';
  const id = contextId?.trim() || '';
  if (!ct && !id) {
    return <span className="text-slate-400">—</span>;
  }
  const upper = ct.toUpperCase();
  const badgeClass =
    upper === 'MANUAL'
      ? 'bg-violet-600/95 text-white'
      : upper === 'AUTO'
        ? 'bg-sky-600/95 text-white'
        : upper === 'JOB'
          ? 'bg-amber-600/95 text-white'
          : upper === 'IMPORT'
            ? 'bg-emerald-700/95 text-white'
            : upper === 'SYSTEM'
              ? 'bg-slate-600/95 text-white'
              : 'bg-slate-500/90 text-white';
  const subtitle =
    upper === 'MANUAL'
      ? 'Admin or UI change'
      : upper === 'AUTO'
        ? 'Automated pricing'
        : upper === 'JOB'
          ? 'Job-driven catalog update'
          : upper === 'IMPORT'
            ? 'Bulk CSV import'
            : upper === 'SYSTEM'
              ? 'System job'
              : null;

  return (
    <div className="flex flex-col gap-2 min-w-[11rem] max-w-[20rem]">
      {subtitle ? (
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100 leading-snug">{subtitle}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex shrink-0 rounded px-2 py-0.5 text-[11px] font-bold tracking-wide ${badgeClass}`}
        >
          {upper || '—'}
        </span>
      </div>
      {id ? <ContextIdLine id={id} contextUpper={upper} /> : null}
    </div>
  );
}

function partInfoFieldLabel(field: string): string {
  switch (field) {
    case 'PN':
      return 'PN';
    case 'VENDOR_PART_ID':
      return 'Supplier part #';
    case 'ALT_PN':
      return 'Alt PN';
    case 'UNITS':
      return 'Units';
    case 'NOMENCLATURE':
      return 'Description';
    case 'VENDOR':
      return 'Vendor';
    case 'REORDER_POINT':
      return 'Min On Hand';
    case 'ORDER_MINIMUM':
      return 'Order Minimum';
    default:
      return field;
  }
}

function coerceBigIntish(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'string') return v;
  return String(v);
}

function numFromDecimalish(v: unknown): number {
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v);
  return NaN;
}

/** Part catalog / import context for profile audit rows. */
function PartInfoContextCell({ contextType, contextId }: { contextType: string; contextId: string | null }) {
  const ct = contextType?.trim() || '';
  const id = contextId?.trim() || '';
  if (!ct && !id) {
    return <span className="text-slate-400">—</span>;
  }
  const upper = ct.toUpperCase();
  const badgeClass =
    upper === 'MANUAL'
      ? 'bg-violet-600/95 text-white'
      : upper === 'IMPORT'
        ? 'bg-emerald-700/95 text-white'
        : 'bg-slate-500/90 text-white';
  const subtitle = upper === 'MANUAL' ? 'Admin or UI change' : upper === 'IMPORT' ? 'Bulk import' : null;

  return (
    <div className="flex flex-col gap-2 min-w-[11rem] max-w-[20rem]">
      {subtitle ? (
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100 leading-snug">{subtitle}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex shrink-0 rounded px-2 py-0.5 text-[11px] font-bold tracking-wide ${badgeClass}`}
        >
          {upper || '—'}
        </span>
      </div>
      {id ? <ContextIdLine id={id} contextUpper={upper} /> : null}
    </div>
  );
}

function unifiedEventSummary(event: UnifiedLogEvent): string {
  const p = event.payload;
  if (event.kind === 'quantity') {
    const d = Number(coerceBigIntish(p.quantity_delta));
    const t = String(p.type ?? '');
    const before = coerceBigIntish(p.quantity_before);
    const after = coerceBigIntish(p.quantity_after);
    const movementParams = {
      type: t,
      contextType: typeof p.context_type === 'string' ? p.context_type : null,
      note: typeof p.note === 'string' ? p.note : null,
    };
    const jobNumber =
      typeof p.context_id === 'string' && p.context_id.trim()
        ? ` ${p.context_id.trim()}`
        : '';
    if (isStockInDeletedFromJobMovement(movementParams)) {
      return `Stock in deleted from job${jobNumber} ${d >= 0 ? '+' : ''}${d} (${before} → ${after})`;
    }
    if (isStockInReversalFromJobMovement(movementParams)) {
      return `Stock in reversed from job${jobNumber} ${d >= 0 ? '+' : ''}${d} (${before} → ${after})`;
    }
    if (isStockInFromJobMovement(movementParams)) {
      return `Stock in from job${jobNumber} ${d >= 0 ? '+' : ''}${d} (${before} → ${after})`;
    }
    return `${t} ${d >= 0 ? '+' : ''}${d} (${before} → ${after})`;
  }
  if (event.kind === 'cost') {
    const after = numFromDecimalish(p.cost_after);
    const beforeRaw = p.cost_before;
    if (beforeRaw === null || beforeRaw === undefined) {
      return `Opening cost $${Number.isFinite(after) ? after.toFixed(2) : '?'}`;
    }
    const before = numFromDecimalish(beforeRaw);
    return `$${Number.isFinite(before) ? before.toFixed(2) : '?'} → $${Number.isFinite(after) ? after.toFixed(2) : '?'}`;
  }
  const changes = p.changes;
  if (Array.isArray(changes) && changes.length > 0) {
    return (changes as PartInfoDiffRow[]).map((c) => partInfoFieldLabel(c.field)).join(', ');
  }
  const note = typeof p.note === 'string' ? p.note.trim() : '';
  return note || 'Part info update';
}

export default function PartsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { hasPermission, isLoading: permissionsLoading, isSuperAdmin, isDeveloper } = usePermissions();
  const { isBootstrapping } = useAppBootstrap();
  const [parts, setParts] = useState<Part[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPartsLoading, setIsPartsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'parts' | 'logs'>('parts');
  const [logsView, setLogsView] = useState<'all' | 'quantity' | 'cost' | 'profile'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [selectedPart, setSelectedPart] = useState<Part | null>(null);
  const [showPartDetails, setShowPartDetails] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [showDeletePartModal, setShowDeletePartModal] = useState(false);
  const [isDeletingPart, setIsDeletingPart] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);

  // Pagination
  const [partsPage, setPartsPage] = useState(1);
  const [movementsPage, setMovementsPage] = useState(1);
  const [costChangesPage, setCostChangesPage] = useState(1);
  const [logsUnifiedPage, setLogsUnifiedPage] = useState(1);
  const [partInfoChangesPage, setPartInfoChangesPage] = useState(1);
  const [partsTotal, setPartsTotal] = useState(0);
  const [inventoryTotalValue, setInventoryTotalValue] = useState<number | null>(null);
  const [movementsTotal, setMovementsTotal] = useState(0);
  const [costChangesTotal, setCostChangesTotal] = useState(0);
  const [costChanges, setCostChanges] = useState<PartCostChangeRow[]>([]);
  const [unifiedEvents, setUnifiedEvents] = useState<UnifiedLogEvent[]>([]);
  const [unifiedTotal, setUnifiedTotal] = useState(0);
  const [partInfoChanges, setPartInfoChanges] = useState<PartInfoChangeRow[]>([]);
  const [partInfoChangesTotal, setPartInfoChangesTotal] = useState(0);
  const [detailUnifiedEvents, setDetailUnifiedEvents] = useState<UnifiedLogEvent[]>([]);
  const [detailUnifiedTotal, setDetailUnifiedTotal] = useState(0);
  const [detailUnifiedLoading, setDetailUnifiedLoading] = useState(false);
  const limit = 50;
  const detailUnifiedLimit = 40;

  // Active filter: debounce briefly while typing and update results continuously.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
      setPartsPage(1); // Reset to first page when search changes
    }, 220);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Check user role — all authenticated users can access inventory; admins also get Logs.
  const userRole = (session?.user as any)?.role;
  const loadingFallback = permissionLoadingFallback({
    role: userRole,
    isSuperAdmin,
    isDeveloper,
  });
  const canViewInventory = permissionsLoading ? loadingFallback : hasPermission('inventory.view');
  const canAddPart = permissionsLoading ? loadingFallback : hasPermission('inventory.add_part');
  const canEditPart = permissionsLoading ? loadingFallback : hasPermission('inventory.edit_part');
  const canDeletePart = permissionsLoading ? loadingFallback : hasPermission('inventory.delete_part');
  const canAdjustQuantity = permissionsLoading ? loadingFallback : hasPermission('inventory.adjust_quantity');
  const canViewInventoryLogs = permissionsLoading ? loadingFallback : hasPermission('inventory.logs.view');
  const canViewCostHistory = permissionsLoading ? loadingFallback : hasPermission('inventory.cost_history.view');
  const canViewVendorPriceImports = permissionsLoading ? loadingFallback : hasPermission('inventory.vendor_prices.import');
  const isAccessDenied = status === 'authenticated' && !permissionsLoading && !canViewInventory;
  const loadParts = useCallback(async () => {
    if (!canViewInventory) {
      setParts([]);
      setPartsTotal(0);
      setInventoryTotalValue(null);
      setIsPartsLoading(false);
      return;
    }

    try {
      setIsPartsLoading(true);
      setError(null);

      const params = new URLSearchParams({
        page: partsPage.toString(),
        limit: limit.toString(),
      });
      if (debouncedSearchTerm) params.append('search', debouncedSearchTerm);
      if (showLowStockOnly) params.append('lowStock', '1');

      const response = await fetch(`/api/admin/parts?${params}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to load parts');
      }

      const data = await response.json();
      setParts(data.parts || []);
      setPartsTotal(data.pagination?.total || 0);
      setInventoryTotalValue(
        typeof data.totalInventoryValue === 'number' && Number.isFinite(data.totalInventoryValue)
          ? data.totalInventoryValue
          : null,
      );
    } catch (err) {
      console.error('Error loading parts:', err);
      setError((err as Error).message);
    } finally {
      setIsPartsLoading(false);
      setIsLoading(false);
    }
  }, [canViewInventory, partsPage, limit, debouncedSearchTerm, showLowStockOnly]);

  /** Global quantity adjustment list (never filtered by selected part — avoids stale subset in the modal bug). */
  const loadMovements = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page: movementsPage.toString(),
        limit: limit.toString(),
      });

      const response = await fetch(`/api/admin/inventory-movements?${params}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to load movements');
      }

      const data = await response.json();
      setMovements(data.movements || []);
      setMovementsTotal(data.pagination?.total || 0);
    } catch (err) {
      console.error('Error loading movements:', err);
    }
  }, [movementsPage, limit]);

  const loadCostChanges = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page: costChangesPage.toString(),
        limit: limit.toString(),
      });

      const response = await fetch(`/api/admin/part-cost-changes?${params}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to load cost history');
      }

      const data = await response.json();
      setCostChanges(data.changes || []);
      setCostChangesTotal(data.pagination?.total || 0);
    } catch (err) {
      console.error('Error loading cost history:', err);
    }
  }, [costChangesPage, limit]);

  const loadUnifiedLog = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page: logsUnifiedPage.toString(),
        limit: limit.toString(),
      });
      const response = await fetch(`/api/admin/part-unified-log?${params}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to load unified log');
      }
      const data = await response.json();
      const raw = (data.events || []) as UnifiedLogEvent[];
      setUnifiedEvents(
        raw.map((e) => ({
          ...e,
          payload: (e.payload && typeof e.payload === 'object' ? e.payload : {}) as Record<string, unknown>,
        })),
      );
      setUnifiedTotal(data.pagination?.total || 0);
    } catch (err) {
      console.error('Error loading unified log:', err);
    }
  }, [logsUnifiedPage, limit]);

  const loadPartInfoChanges = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page: partInfoChangesPage.toString(),
        limit: limit.toString(),
      });
      const response = await fetch(`/api/admin/part-info-changes?${params}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to load part info changes');
      }
      const data = await response.json();
      const rows = (data.changes || []) as PartInfoChangeRow[];
      setPartInfoChanges(
        rows.map((r) => ({
          ...r,
          changes: Array.isArray(r.changes) ? r.changes : [],
        })),
      );
      setPartInfoChangesTotal(data.pagination?.total || 0);
    } catch (err) {
      console.error('Error loading part info changes:', err);
    }
  }, [partInfoChangesPage, limit]);

  const loadPartDetailUnified = useCallback(
    async (partId: string) => {
      if (!canViewCostHistory) {
        setDetailUnifiedEvents([]);
        setDetailUnifiedTotal(0);
        return;
      }
      try {
        setDetailUnifiedLoading(true);
        const params = new URLSearchParams({
          page: '1',
          limit: detailUnifiedLimit.toString(),
          partId,
        });
        const response = await fetch(`/api/admin/part-unified-log?${params}`);
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to load recent activity');
        }
        const data = await response.json();
        const raw = (data.events || []) as UnifiedLogEvent[];
        setDetailUnifiedEvents(
          raw.map((e) => ({
            ...e,
            payload: (e.payload && typeof e.payload === 'object' ? e.payload : {}) as Record<string, unknown>,
          })),
        );
        setDetailUnifiedTotal(data.pagination?.total || 0);
      } catch (err) {
        console.error('Error loading part detail unified log:', err);
      } finally {
        setDetailUnifiedLoading(false);
      }
    },
    [canViewCostHistory, detailUnifiedLimit],
  );

  const refreshAdminAuditFeeds = useCallback(() => {
    if (!canViewInventoryLogs) return;
    void loadMovements();
    void loadCostChanges();
    void loadPartInfoChanges();
    void loadUnifiedLog();
  }, [canViewInventoryLogs, loadMovements, loadCostChanges, loadPartInfoChanges, loadUnifiedLog]);

  useEffect(() => {
    if (status === 'loading' || permissionsLoading) return;

    if (!session) {
      router.push('/login?callbackUrl=/parts');
      return;
    }
    if (isAccessDenied) {
      setIsLoading(false);
    }
  }, [isAccessDenied, permissionsLoading, router, session, status]);

  useEffect(() => {
    if (activeTab !== 'logs') return;
    setMovementsPage(1);
    setCostChangesPage(1);
    setLogsUnifiedPage(1);
    setPartInfoChangesPage(1);
  }, [logsView, activeTab]);

  useEffect(() => {
    if (status === 'loading' || permissionsLoading || !session || !canViewInventory) return;
    if (activeTab !== 'parts') return;
    void loadParts();
  }, [session, status, permissionsLoading, canViewInventory, activeTab, partsPage, debouncedSearchTerm, loadParts]);

  useEffect(() => {
    if (!canViewInventory) return;
    if (activeTab === 'logs' && !canViewInventoryLogs) {
      setActiveTab('parts');
      return;
    }
    if (activeTab !== 'logs' || !canViewInventoryLogs) return;
    if (logsView === 'all') void loadUnifiedLog();
    else if (logsView === 'quantity') void loadMovements();
    else if (logsView === 'cost') void loadCostChanges();
    else if (logsView === 'profile') void loadPartInfoChanges();
  }, [
    activeTab,
    logsView,
    canViewInventoryLogs,
    movementsPage,
    costChangesPage,
    logsUnifiedPage,
    partInfoChangesPage,
    loadMovements,
    loadCostChanges,
    loadUnifiedLog,
    loadPartInfoChanges,
    canViewInventory,
  ]);

  useEffect(() => {
    if (!showPartDetails || !selectedPart || !canViewCostHistory) return;
    void loadPartDetailUnified(selectedPart.id);
  }, [showPartDetails, selectedPart?.id, canViewCostHistory, loadPartDetailUnified]);

  const handlePartClick = (part: Part) => {
    setMovementsPage(1);
    setCostChangesPage(1);
    setLogsUnifiedPage(1);
    setPartInfoChangesPage(1);
    setSelectedPart(part);
    setShowPartDetails(true);
  };

  const handleDeletePart = async () => {
    if (!selectedPart) return;

    try {
      setIsDeletingPart(true);
      setError(null);

      const response = await fetch(`/api/admin/parts/${selectedPart.id}`, {
        method: 'DELETE',
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to delete part');
      }

      setSuccessMessage(data.message || `Part "${selectedPart.pn}" deleted successfully.`);
      setShowDeletePartModal(false);
      setShowPartDetails(false);
      setIsEditModalOpen(false);
      setIsAdjustModalOpen(false);
      setSelectedPart(null);
      setDetailUnifiedEvents([]);
      setDetailUnifiedTotal(0);
      await loadParts();
      refreshAdminAuditFeeds();
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsDeletingPart(false);
    }
  };

  if (isBootstrapping) {
    return (
      <DashboardBootstrapShell message="Loading inventory...">
        <DashboardContentSkeleton />
      </DashboardBootstrapShell>
    );
  }

  if (isLoading) {
    return (
      <div className="h-screen bg-slate-100 dark:bg-slate-900 flex">
        <DashboardSidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <header className="sticky top-0 z-10 bg-white dark:bg-slate-800/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700/50">
            <div className="px-6 py-4">
              <div className="h-10 w-64 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700/50" />
              <div className="mt-2 h-4 w-80 animate-pulse rounded bg-slate-200/80 dark:bg-slate-700/40" />
            </div>
          </header>
          <DashboardContentSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-slate-100 dark:bg-slate-900 flex">
      {/* Left Sidebar */}
      <DashboardSidebar />

      {/* Main Content Area */}
      <div className={`flex-1 flex flex-col overflow-hidden ${isAccessDenied ? 'pointer-events-none select-none blur-sm opacity-60' : ''}`}>
        {/* Header */}
        <header className="sticky top-0 z-10 bg-white dark:bg-slate-800/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700/50">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white">
                  Inventory Management
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-medium">
                  Parts inventory, quantity audit, and catalog cost history
                </p>
              </div>

              {(canAddPart || canViewVendorPriceImports) && (
                <div className="flex flex-wrap items-center gap-2">
                  {canViewVendorPriceImports && (
                  <Link
                    href="/parts/price-updates"
                    className="px-5 py-3 bg-slate-200 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600/80 text-slate-700 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-300 dark:hover:bg-slate-700/70 transition-all flex items-center gap-2"
                  >
                    Vendor price update
                  </Link>
                  )}
                  {canAddPart && (
                  <button
                    onClick={() => setIsAddModalOpen(true)}
                    className="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20 flex items-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    Add Part
                  </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        {successMessage && (
          <div className="px-6 pt-4">
            <div className="bg-green-600 text-white p-4 rounded-xl shadow-lg">
              <p className="font-bold">{successMessage}</p>
            </div>
          </div>
        )}

        {/* Error Banner */}
        {
          error && (
            <div className="px-6 pt-4">
              <div className="bg-red-500 text-white p-4 rounded-xl shadow-lg">
                <p className="font-bold">Error: {error}</p>
              </div>
            </div>
          )
        }

        {/* Main Content */}
        <main className="flex-1 flex flex-col overflow-hidden px-6 py-6 bg-slate-100 dark:bg-slate-900 min-h-0">
          <div className="bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl p-6 sm:p-8 flex flex-col overflow-hidden min-h-0 h-full shadow-sm dark:shadow-none">
            {/* Tabs */}
            <div className="mb-6 flex flex-shrink-0 flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setActiveTab('parts')}
                  className={`px-6 py-3 rounded-xl font-semibold transition-all ${activeTab === 'parts'
                    ? 'bg-blue-600 text-white shadow-lg'
                    : 'bg-slate-200 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600/80 hover:bg-slate-300 dark:hover:bg-slate-700/70'
                    }`}
                >
                  Inventory ({partsTotal})
                </button>
                {canViewInventoryLogs && (
                  <button
                    onClick={() => setActiveTab('logs')}
                    className={`px-6 py-3 rounded-xl font-semibold transition-all ${activeTab === 'logs'
                      ? 'bg-blue-600 text-white shadow-lg'
                      : 'bg-slate-200 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600/80 hover:bg-slate-300 dark:hover:bg-slate-700/70'
                      }`}
                  >
                    Logs
                  </button>
                )}
                {activeTab === 'parts' && (
                  <label className="inline-flex items-center gap-2 px-3 py-3 text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showLowStockOnly}
                      onChange={(e) => {
                        setShowLowStockOnly(e.target.checked);
                        setPartsPage(1);
                      }}
                      className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                    />
                    Show low stock only
                  </label>
                )}
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-right dark:border-slate-600 dark:bg-slate-900/40">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Total Inventory Value
                </div>
                <div className="text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                  {formatInventoryValue(inventoryTotalValue)}
                </div>
              </div>
            </div>

            {/* Parts Tab */}
            {activeTab === 'parts' && (
              <div className="flex flex-col overflow-hidden min-h-0 flex-1">
                {/* Search */}
                <div className="mb-6 flex-shrink-0">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search by part #, supplier part #, or description..."
                      value={searchTerm}
                      onChange={(e) => {
                        setSearchTerm(e.target.value);
                      }}
                      className="w-full px-4 py-2.5 pl-11 bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-600/80 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500 shadow-sm hover:border-slate-400 dark:hover:border-slate-500/80 transition-all"
                    />
                    <svg
                      className="absolute left-3.5 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-500 dark:text-slate-400 pointer-events-none"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    {isPartsLoading && (
                      <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Parts Table */}
                <div className="flex-1 overflow-y-auto overflow-x-auto min-h-0">
                  <table className="w-full">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b-2 border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-800/95 backdrop-blur-sm">
                        <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Part Number</th>
                        <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Supplier Part #</th>
                        <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Description</th>
                        <th className="text-right py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">On Hand</th>
                        <th className="text-right py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Min On Hand</th>
                        <th className="text-right py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Order Min</th>
                        <th className="text-right py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Suggested Qty</th>
                        <th className="text-right py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Current Price</th>
                        <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Vendor</th>
                        <th className="text-right py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Updated</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                      {parts.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="text-center py-12 text-slate-500 dark:text-slate-400">
                            {searchTerm ? 'No parts found matching your search' : 'No parts available'}
                          </td>
                        </tr>
                      ) : (
                        parts
                          .filter((part) => {
                            // Filter out parts with no part number (likely header rows or invalid data)
                            return part.pn && part.pn.trim() !== '' && part.pn !== '-';
                          })
                          .map((part) => {
                            const lowStock = isPartLowStock(part);
                            const suggestedQty = getSuggestedReorderQty(part);
                            return (
                            <tr
                              key={part.id}
                              className={`border-b border-slate-200 dark:border-slate-700/30 hover:bg-slate-100 dark:hover:bg-slate-700/30 transition-colors cursor-pointer ${
                                lowStock ? 'bg-amber-50/80 dark:bg-yellow-900/20' : ''
                              }`}
                              onClick={() => handlePartClick(part)}
                            >
                              <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">{part.pn}</td>
                              <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{part.vendorPartID || part.altPN || '-'}</td>
                              <td className="py-3 px-4 text-slate-600 dark:text-slate-300 max-w-md truncate" title={part.nomenclature}>
                                {part.nomenclature || '-'}
                              </td>
                              <td className="py-3 px-4 text-right">
                                <span className={`font-semibold ${lowStock ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'}`}>
                                  {part.quantity.toLocaleString()}
                                </span>
                                {lowStock && (
                                  <span className="ml-2 px-2 py-0.5 bg-red-600/80 text-white rounded text-xs font-medium">
                                    Low Stock
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-right text-slate-600 dark:text-slate-300 tabular-nums">
                                {part.reorderPoint != null ? part.reorderPoint.toLocaleString() : '—'}
                              </td>
                              <td className="py-3 px-4 text-right text-slate-600 dark:text-slate-300 tabular-nums">
                                {part.orderMinimum != null ? part.orderMinimum.toLocaleString() : '—'}
                              </td>
                              <td className="py-3 px-4 text-right text-slate-600 dark:text-slate-300 tabular-nums">
                                {suggestedQty != null ? suggestedQty.toLocaleString() : '—'}
                              </td>
                              <td className="py-3 px-4 text-right text-slate-600 dark:text-slate-300 tabular-nums">
                                {formatInventoryValue(part.cost)}
                              </td>
                              <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{part.vendor || '-'}</td>
                              <td className="py-3 px-4 text-right text-sm text-slate-500 dark:text-slate-500">
                                {formatDateInAppTimeZone(part.updatedAt)}
                              </td>
                            </tr>
                          );
                          })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {partsTotal > limit && (
                  <div className="mt-6 flex items-center justify-between flex-shrink-0">
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      Showing {(partsPage - 1) * limit + 1} to {Math.min(partsPage * limit, partsTotal)} of {partsTotal}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setPartsPage(p => Math.max(1, p - 1))}
                        disabled={partsPage === 1}
                        className="px-4 py-2 bg-slate-200 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600/80 rounded-xl font-semibold text-sm text-slate-700 dark:text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-300 dark:hover:bg-slate-700/70 transition-all"
                      >
                        Previous
                      </button>
                      <button
                        onClick={() => setPartsPage(p => p + 1)}
                        disabled={partsPage * limit >= partsTotal}
                        className="px-4 py-2 bg-slate-200 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600/80 rounded-xl font-semibold text-sm text-slate-700 dark:text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-300 dark:hover:bg-slate-700/70 transition-all"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Logs — merged timeline + filtered feeds (admin) */}
            {activeTab === 'logs' && canViewInventoryLogs && (
              <div className="flex flex-col overflow-hidden min-h-0 flex-1">
                <div className="mb-4 flex flex-wrap gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setLogsView('all')}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${logsView === 'all'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                      : 'bg-slate-200 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600/80 hover:bg-slate-300 dark:hover:bg-slate-700/70'
                      }`}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setLogsView('quantity')}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${logsView === 'quantity'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                      : 'bg-slate-200 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600/80 hover:bg-slate-300 dark:hover:bg-slate-700/70'
                      }`}
                  >
                    Quantity adjustment
                  </button>
                  <button
                    type="button"
                    onClick={() => setLogsView('cost')}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${logsView === 'cost'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                      : 'bg-slate-200 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600/80 hover:bg-slate-300 dark:hover:bg-slate-700/70'
                      }`}
                  >
                    Cost
                  </button>
                  <button
                    type="button"
                    onClick={() => setLogsView('profile')}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${logsView === 'profile'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                      : 'bg-slate-200 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600/80 hover:bg-slate-300 dark:hover:bg-slate-700/70'
                      }`}
                  >
                    Part info
                  </button>
                </div>

                {logsView === 'all' && (
                  <div className="flex flex-col overflow-hidden min-h-0 flex-1">
                    <div className="flex-1 overflow-y-auto overflow-x-auto min-h-0">
                      <table className="w-full">
                        <thead className="sticky top-0 z-10">
                          <tr className="border-b-2 border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-800/95 backdrop-blur-sm">
                            <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Time</th>
                            <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Kind</th>
                            <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Part</th>
                            <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Summary</th>
                            <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Actor</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                          {unifiedEvents.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="text-center py-12 text-slate-500 dark:text-slate-400">
                                No log events found
                              </td>
                            </tr>
                          ) : (
                            unifiedEvents.map((event) => (
                              <tr
                                key={`${event.kind}-${event.eventId}`}
                                className="border-b border-slate-200 dark:border-slate-700/30 hover:bg-slate-100 dark:hover:bg-slate-700/30 transition-colors"
                              >
                                <td className="py-3 px-4 text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                  {formatDateInAppTimeZone(event.createdAt, {
                                    year: 'numeric',
                                    month: 'numeric',
                                    day: 'numeric',
                                    hour: 'numeric',
                                    minute: '2-digit',
                                  })}
                                </td>
                                <td className="py-3 px-4">
                                  <span
                                    className={`inline-flex rounded px-2 py-0.5 text-[11px] font-bold tracking-wide text-white ${event.kind === 'quantity'
                                      ? 'bg-amber-600/95'
                                      : event.kind === 'cost'
                                        ? 'bg-sky-600/95'
                                        : 'bg-emerald-700/95'
                                      }`}
                                  >
                                    {event.kind === 'quantity'
                                      ? 'Quantity'
                                      : event.kind === 'cost'
                                        ? 'Cost'
                                        : 'Part info'}
                                  </span>
                                </td>
                                <td className="py-3 px-4">
                                  <div>
                                    <div className="font-semibold text-slate-900 dark:text-white">{event.part.pn}</div>
                                    <div className="text-xs text-slate-500 dark:text-slate-500 truncate max-w-xs">
                                      {event.part.nomenclature}
                                    </div>
                                  </div>
                                </td>
                                <td className="py-3 px-4 text-sm text-slate-700 dark:text-slate-200 max-w-md">
                                  {unifiedEventSummary(event)}
                                </td>
                                <td className="py-3 px-4 text-sm text-slate-500 dark:text-slate-400">
                                  {event.actor?.name?.trim() || event.actor?.email || event.actorUserId || '—'}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                    {unifiedTotal > limit && (
                      <div className="mt-6 flex items-center justify-between flex-shrink-0">
                        <div className="text-sm text-slate-500 dark:text-slate-400">
                          Showing {(logsUnifiedPage - 1) * limit + 1} to {Math.min(logsUnifiedPage * limit, unifiedTotal)} of {unifiedTotal}
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setLogsUnifiedPage((p) => Math.max(1, p - 1))}
                            disabled={logsUnifiedPage === 1}
                            className="px-4 py-2 bg-slate-200 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600/80 rounded-xl font-semibold text-sm text-slate-700 dark:text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-300 dark:hover:bg-slate-700/70 transition-all"
                          >
                            Previous
                          </button>
                          <button
                            type="button"
                            onClick={() => setLogsUnifiedPage((p) => p + 1)}
                            disabled={logsUnifiedPage * limit >= unifiedTotal}
                            className="px-4 py-2 bg-slate-200 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600/80 rounded-xl font-semibold text-sm text-slate-700 dark:text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-300 dark:hover:bg-slate-700/70 transition-all"
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {logsView === 'quantity' && (
              <div className="flex flex-col overflow-hidden min-h-0 flex-1">
                {/* Quantity adjustments (inventory movements) */}
                <div className="flex-1 overflow-y-auto overflow-x-auto min-h-0">
                  <table className="w-full">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b-2 border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-800/95 backdrop-blur-sm">
                        <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Time</th>
                        <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Part</th>
                        <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Type</th>
                        <th className="text-right py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Delta</th>
                        <th className="text-right py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Before</th>
                        <th className="text-right py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">After</th>
                        <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Actor</th>
                        <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Source</th>
                        <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                      {movements.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="text-center py-12 text-slate-500 dark:text-slate-400">
                            No quantity adjustments found
                          </td>
                        </tr>
                      ) : (
                        movements.map((movement) => (
                          <tr
                            key={movement.id}
                            className="border-b border-slate-200 dark:border-slate-700/30 hover:bg-slate-100 dark:hover:bg-slate-700/30 transition-colors"
                          >
                            <td className="py-3 px-4 text-sm text-slate-500 dark:text-slate-400">
                              {formatDateInAppTimeZone(movement.createdAt, {
                                year: 'numeric',
                                month: 'numeric',
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                            </td>
                            <td className="py-3 px-4">
                              <div>
                                <div className="font-semibold text-slate-900 dark:text-white">{movement.part.pn}</div>
                                <div className="text-xs text-slate-500 dark:text-slate-500 truncate max-w-xs">
                                  {movement.part.nomenclature}
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <span className={`px-2 py-1 rounded text-xs font-medium ${movement.type === 'PULL'
                                ? 'bg-red-600/80 text-white'
                                : movement.type === 'UNPULL'
                                  ? 'bg-green-600/80 text-white'
                                  : 'bg-blue-600/80 text-white'
                                }`}>
                                {movementTypeLabel(movement)}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <span className={`font-semibold ${movement.quantityDelta < 0 ? 'text-red-500 dark:text-red-400' : 'text-green-600 dark:text-green-400'
                                }`}>
                                {movement.quantityDelta > 0 ? '+' : ''}{movement.quantityDelta.toLocaleString()}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right text-slate-500 dark:text-slate-400">
                              {movement.quantityBefore.toLocaleString()}
                            </td>
                            <td className="py-3 px-4 text-right font-semibold text-slate-900 dark:text-white">
                              {movement.quantityAfter.toLocaleString()}
                            </td>
                            <td className="py-3 px-4 text-sm text-slate-500 dark:text-slate-400">
                              {movement.actor?.name?.trim() || movement.actor?.email || movement.actorUserId}
                            </td>
                            <td className="py-3 px-4 text-sm text-slate-500 dark:text-slate-400 align-top">
                              <MovementContextCell contextType={movement.contextType} contextId={movement.contextId} />
                            </td>
                            <td className="py-3 px-4 align-top min-w-[12rem] max-w-lg">
                              <p
                                className="text-sm leading-relaxed text-slate-700 dark:text-slate-200 whitespace-normal break-words"
                                title={movement.note || undefined}
                              >
                                {displayMovementNote(movement.note, movement.contextType) || '—'}
                              </p>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {movementsTotal > limit && (
                  <div className="mt-6 flex items-center justify-between flex-shrink-0">
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      Showing {(movementsPage - 1) * limit + 1} to {Math.min(movementsPage * limit, movementsTotal)} of {movementsTotal}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setMovementsPage(p => Math.max(1, p - 1))}
                        disabled={movementsPage === 1}
                        className="px-4 py-2 bg-slate-200 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600/80 rounded-xl font-semibold text-sm text-slate-700 dark:text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-300 dark:hover:bg-slate-700/70 transition-all"
                      >
                        Previous
                      </button>
                      <button
                        onClick={() => setMovementsPage(p => p + 1)}
                        disabled={movementsPage * limit >= movementsTotal}
                        className="px-4 py-2 bg-slate-200 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600/80 rounded-xl font-semibold text-sm text-slate-700 dark:text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-300 dark:hover:bg-slate-700/70 transition-all"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
                )}

                {logsView === 'cost' && (
              <div className="flex flex-col overflow-hidden min-h-0 flex-1">
                <div className="flex-1 overflow-y-auto overflow-x-auto min-h-0">
                  <table className="w-full">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b-2 border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-800/95 backdrop-blur-sm">
                        <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Time</th>
                        <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Part</th>
                        <th className="text-right py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Before</th>
                        <th className="text-right py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">After</th>
                        <th className="text-right py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Delta</th>
                        <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Actor</th>
                        <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Source</th>
                        <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                      {costChanges.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="text-center py-12 text-slate-500 dark:text-slate-400">
                            No cost changes recorded
                          </td>
                        </tr>
                      ) : (
                        costChanges.map((row) => {
                          const delta =
                            row.costBefore === null ? row.costAfter : row.costAfter - row.costBefore;
                          return (
                            <tr
                              key={row.id}
                              className="border-b border-slate-200 dark:border-slate-700/30 hover:bg-slate-100 dark:hover:bg-slate-700/30 transition-colors"
                            >
                              <td className="py-3 px-4 text-sm text-slate-500 dark:text-slate-400">
                                {formatDateInAppTimeZone(row.createdAt, {
                                  year: 'numeric',
                                  month: 'numeric',
                                  day: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })}
                              </td>
                              <td className="py-3 px-4">
                                <div>
                                  <div className="font-semibold text-slate-900 dark:text-white">{row.part.pn}</div>
                                  <div className="text-xs text-slate-500 dark:text-slate-500 truncate max-w-xs">
                                    {row.part.nomenclature}
                                  </div>
                                </div>
                              </td>
                              <td className="py-3 px-4 text-right text-slate-500 dark:text-slate-400">
                                {row.costBefore === null ? '—' : `$${row.costBefore.toFixed(2)}`}
                              </td>
                              <td className="py-3 px-4 text-right font-semibold text-slate-900 dark:text-white">
                                ${row.costAfter.toFixed(2)}
                              </td>
                              <td className="py-3 px-4 text-right">
                                {row.costBefore === null ? (
                                  <span className="font-semibold text-green-600 dark:text-green-400" title="Opening cost">
                                    +${row.costAfter.toFixed(2)}
                                  </span>
                                ) : (
                                  <span
                                    className={`font-semibold ${delta < 0 ? 'text-red-500 dark:text-red-400' : delta > 0 ? 'text-green-600 dark:text-green-400' : 'text-slate-500'}`}
                                  >
                                    {delta > 0 ? '+' : ''}${delta.toFixed(2)}
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-sm text-slate-500 dark:text-slate-400">
                                {row.actor?.name?.trim() ||
                                  row.actor?.email ||
                                  row.actorUserId ||
                                  'System'}
                              </td>
                              <td className="py-3 px-4 text-sm align-top">
                                <CatalogCostContextCell contextType={row.contextType} contextId={row.contextId} />
                              </td>
                              <td className="py-3 px-4 align-top min-w-[10rem] max-w-lg">
                                <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200 whitespace-normal break-words">
                                  {row.note?.trim() || '—'}
                                </p>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {costChangesTotal > limit && (
                  <div className="mt-6 flex items-center justify-between flex-shrink-0">
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      Showing {(costChangesPage - 1) * limit + 1} to {Math.min(costChangesPage * limit, costChangesTotal)} of{' '}
                      {costChangesTotal}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setCostChangesPage((p) => Math.max(1, p - 1))}
                        disabled={costChangesPage === 1}
                        className="px-4 py-2 bg-slate-200 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600/80 rounded-xl font-semibold text-sm text-slate-700 dark:text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-300 dark:hover:bg-slate-700/70 transition-all"
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        onClick={() => setCostChangesPage((p) => p + 1)}
                        disabled={costChangesPage * limit >= costChangesTotal}
                        className="px-4 py-2 bg-slate-200 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600/80 rounded-xl font-semibold text-sm text-slate-700 dark:text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-300 dark:hover:bg-slate-700/70 transition-all"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
                )}

                {logsView === 'profile' && (
              <div className="flex flex-col overflow-hidden min-h-0 flex-1">
                <div className="flex-1 overflow-y-auto overflow-x-auto min-h-0">
                  <table className="w-full">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b-2 border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-800/95 backdrop-blur-sm">
                        <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Time</th>
                        <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Part</th>
                        <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Fields</th>
                        <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Actor</th>
                        <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Source</th>
                        <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                      {partInfoChanges.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-center py-12 text-slate-500 dark:text-slate-400">
                            No part info changes recorded
                          </td>
                        </tr>
                      ) : (
                        partInfoChanges.map((row) => (
                          <tr
                            key={row.id}
                            className="border-b border-slate-200 dark:border-slate-700/30 hover:bg-slate-100 dark:hover:bg-slate-700/30 transition-colors"
                          >
                            <td className="py-3 px-4 text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap">
                              {formatDateInAppTimeZone(row.createdAt, {
                                year: 'numeric',
                                month: 'numeric',
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                            </td>
                            <td className="py-3 px-4">
                              <div>
                                <div className="font-semibold text-slate-900 dark:text-white">{row.part.pn}</div>
                                <div className="text-xs text-slate-500 dark:text-slate-500 truncate max-w-xs">{row.part.nomenclature}</div>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-sm text-slate-700 dark:text-slate-200 max-w-lg align-top">
                              <ul className="list-disc pl-4 space-y-1">
                                {row.changes.map((c, i) => (
                                  <li key={i}>
                                    <span className="font-semibold">{partInfoFieldLabel(c.field)}:</span>{' '}
                                    <span className="text-slate-500">{c.before ?? '—'}</span>
                                    <span className="text-slate-400"> → </span>
                                    <span>{c.after ?? '—'}</span>
                                  </li>
                                ))}
                              </ul>
                            </td>
                            <td className="py-3 px-4 text-sm text-slate-500 dark:text-slate-400">
                              {row.actor?.name?.trim() || row.actor?.email || row.actorUserId || '—'}
                            </td>
                            <td className="py-3 px-4 text-sm align-top">
                              <PartInfoContextCell contextType={row.contextType} contextId={row.contextId} />
                            </td>
                            <td className="py-3 px-4 align-top max-w-md text-sm text-slate-700 dark:text-slate-200 break-words">
                              {row.note?.trim() || '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {partInfoChangesTotal > limit && (
                  <div className="mt-6 flex items-center justify-between flex-shrink-0">
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      Showing {(partInfoChangesPage - 1) * limit + 1} to{' '}
                      {Math.min(partInfoChangesPage * limit, partInfoChangesTotal)} of {partInfoChangesTotal}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setPartInfoChangesPage((p) => Math.max(1, p - 1))}
                        disabled={partInfoChangesPage === 1}
                        className="px-4 py-2 bg-slate-200 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600/80 rounded-xl font-semibold text-sm text-slate-700 dark:text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-300 dark:hover:bg-slate-700/70 transition-all"
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        onClick={() => setPartInfoChangesPage((p) => p + 1)}
                        disabled={partInfoChangesPage * limit >= partInfoChangesTotal}
                        className="px-4 py-2 bg-slate-200 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600/80 rounded-xl font-semibold text-sm text-slate-700 dark:text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-300 dark:hover:bg-slate-700/70 transition-all"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
                )}
              </div>
            )}
          </div>
        </main>

        {/* Part Details Modal */}
        {
          showPartDetails && selectedPart && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 min-h-0 bg-black/50 backdrop-blur-sm">
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/50 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[min(90dvh,calc(100svh-1.5rem))] flex flex-col min-h-0 overflow-hidden">
                <div className="flex flex-shrink-0 items-center justify-between gap-3 p-4 sm:p-6 border-b border-slate-200 dark:border-slate-700/50">
                  <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">Part Details</h2>
                  <button
                    onClick={() => {
                      setShowDeletePartModal(false);
                      setShowPartDetails(false);
                      setSelectedPart(null);
                      setDetailUnifiedEvents([]);
                      setDetailUnifiedTotal(0);
                    }}
                    className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="flex-shrink-0 space-y-4 px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-700/50">
                  <div>
                    <label className="text-sm font-semibold text-slate-500 dark:text-slate-400">Part Number</label>
                    <p className="text-lg font-medium text-slate-900 dark:text-white">{selectedPart.pn}</p>
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-slate-500 dark:text-slate-400">Supplier Part #</label>
                    <p className="text-slate-900 dark:text-white">{selectedPart.vendorPartID || selectedPart.altPN || '—'}</p>
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-slate-500 dark:text-slate-400">Description</label>
                    <p className="text-slate-900 dark:text-white">{selectedPart.nomenclature}</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="text-sm font-semibold text-slate-500 dark:text-slate-400">Quantity On Hand</label>
                      <p className={`text-2xl font-bold ${isPartLowStock(selectedPart) ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'}`}>
                        {selectedPart.quantity.toLocaleString()}
                        {isPartLowStock(selectedPart) && (
                          <span className="ml-2 align-middle px-2 py-0.5 bg-red-600/80 text-white rounded text-xs font-medium">
                            Low Stock
                          </span>
                        )}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-slate-500 dark:text-slate-400">Cost ($)</label>
                      <p className="text-2xl font-bold text-slate-900 dark:text-white">
                        ${selectedPart.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-slate-500 dark:text-slate-400">Minimum On Hand</label>
                      <p className="text-lg text-slate-900 dark:text-white">
                        {selectedPart.reorderPoint != null ? selectedPart.reorderPoint.toLocaleString() : '—'}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-slate-500 dark:text-slate-400">Order Minimum</label>
                      <p className="text-lg text-slate-900 dark:text-white">
                        {selectedPart.orderMinimum != null ? selectedPart.orderMinimum.toLocaleString() : '—'}
                      </p>
                    </div>
                    {getSuggestedReorderQty(selectedPart) != null && (
                      <div className="md:col-span-2">
                        <label className="text-sm font-semibold text-slate-500 dark:text-slate-400">Suggested Reorder Qty</label>
                        <p className="text-lg font-semibold text-amber-700 dark:text-amber-400">
                          {getSuggestedReorderQty(selectedPart)!.toLocaleString()}
                        </p>
                      </div>
                    )}
                  </div>

                  {(canEditPart || canAdjustQuantity || canDeletePart) && (
                    <div className="pt-4 pb-2 flex flex-wrap gap-3">
                      {canEditPart && (
                      <button
                        onClick={() => setIsEditModalOpen(true)}
                        className="flex-1 sm:flex-none px-6 py-3 bg-amber-600/10 text-amber-400 border border-amber-500/30 rounded-xl font-bold hover:bg-amber-600/20 transition-all flex items-center justify-center gap-2"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        Edit Part
                      </button>
                      )}
                      {canAdjustQuantity && (
                      <button
                        onClick={() => setIsAdjustModalOpen(true)}
                        className="flex-1 sm:flex-none px-6 py-3 bg-blue-600/10 text-blue-400 border border-blue-500/30 rounded-xl font-bold hover:bg-blue-600/20 transition-all flex items-center justify-center gap-2"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Adjust Quantity
                      </button>
                      )}
                      {canDeletePart && (
                      <button
                        onClick={() => setShowDeletePartModal(true)}
                        className="flex-1 sm:flex-none px-6 py-3 bg-red-600/10 text-red-500 border border-red-500/40 rounded-xl font-bold hover:bg-red-600/20 transition-all flex items-center justify-center gap-2"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Delete Part
                      </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-1 flex-col min-h-0 px-4 sm:px-6 pb-4 sm:pb-6 pt-3">
                  <h3 className="flex-shrink-0 text-lg font-bold text-slate-900 dark:text-white mb-3">
                    Recent activity
                  </h3>
                  {!canViewCostHistory ? (
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Activity history requires View Cost/Profile History permission.
                    </p>
                  ) : detailUnifiedLoading ? (
                    <p className="text-sm text-slate-500">Loading recent activity…</p>
                  ) : (
                    <>
                      {detailUnifiedTotal > detailUnifiedEvents.length && (
                        <p className="flex-shrink-0 text-xs text-slate-500 mb-2">
                          Showing {detailUnifiedEvents.length} of {detailUnifiedTotal} — open the Logs tab (All or a filter) to page through everything for this part.
                        </p>
                      )}
                      {detailUnifiedEvents.length > 0 ? (
                      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-2 pr-1 -mr-1">
                        {detailUnifiedEvents.map((event) => (
                          <div key={`${event.kind}-${event.eventId}`} className="p-3 bg-slate-100 dark:bg-slate-700/50 rounded-lg">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={`px-2 py-0.5 rounded text-[11px] font-bold text-white ${
                                    event.kind === 'quantity'
                                      ? 'bg-amber-600/95'
                                      : event.kind === 'cost'
                                        ? 'bg-sky-600/95'
                                        : 'bg-emerald-700/95'
                                  }`}
                                >
                                  {event.kind === 'quantity'
                                    ? 'Quantity'
                                    : event.kind === 'cost'
                                      ? 'Cost'
                                      : 'Part info'}
                                </span>
                                <span className="text-sm font-medium text-slate-900 dark:text-white">{unifiedEventSummary(event)}</span>
                              </div>
                              <span className="text-xs text-slate-500 dark:text-slate-500">
                                {formatDateInAppTimeZone(event.createdAt, {
                                  year: 'numeric',
                                  month: 'numeric',
                                  day: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                            {event.kind === 'quantity' && (
                              <>
                                {(event.payload.context_type || event.payload.context_id) && (
                                  <div className="mt-2">
                                    <MovementContextCell
                                      contextType={(event.payload.context_type as string) ?? null}
                                      contextId={(event.payload.context_id as string) ?? null}
                                    />
                                  </div>
                                )}
                                {typeof event.payload.note === 'string' && event.payload.note.trim() !== '' && (
                                  <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200 mt-2 whitespace-pre-wrap break-words">
                                    {displayMovementNote(event.payload.note, (event.payload.context_type as string) ?? null) ||
                                      event.payload.note}
                                  </p>
                                )}
                              </>
                            )}
                            {event.kind === 'cost' && (
                              <div className="mt-2">
                                <CatalogCostContextCell
                                  contextType={String(event.payload.context_type ?? '')}
                                  contextId={(event.payload.context_id as string) ?? null}
                                />
                                {typeof event.payload.note === 'string' && event.payload.note.trim() !== '' && (
                                  <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 whitespace-pre-wrap break-words">
                                    {event.payload.note}
                                  </p>
                                )}
                              </div>
                            )}
                            {event.kind === 'profile' && (
                              <div className="mt-2 space-y-1">
                                <PartInfoContextCell
                                  contextType={String(event.payload.context_type ?? '')}
                                  contextId={(event.payload.context_id as string) ?? null}
                                />
                                {Array.isArray(event.payload.changes) && (event.payload.changes as PartInfoDiffRow[]).length > 0 && (
                                  <ul className="list-disc pl-4 text-sm text-slate-700 dark:text-slate-200">
                                    {(event.payload.changes as PartInfoDiffRow[]).map((c, i) => (
                                      <li key={i}>
                                        <span className="font-semibold">{partInfoFieldLabel(c.field)}:</span>{' '}
                                        <span className="text-slate-500">{c.before ?? '—'}</span>
                                        <span className="text-slate-400"> → </span>
                                        <span>{c.after ?? '—'}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {typeof event.payload.note === 'string' && event.payload.note.trim() !== '' && (
                                  <p className="text-sm text-slate-600 dark:text-slate-300">{event.payload.note}</p>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      ) : (
                        <p className="text-sm text-slate-500">No activity recorded for this part yet.</p>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        }
      </div>

      {showDeletePartModal && selectedPart && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/50 rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold text-red-500 dark:text-red-400 mb-4">Delete Part</h2>
            <p className="text-slate-600 dark:text-slate-300 mb-2">
              Are you sure you want to delete this part?
            </p>
            <p className="text-slate-900 dark:text-white font-semibold mb-2">
              {selectedPart.pn}
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
              This action cannot be undone. Deletion is blocked if the part is still used by active jobs.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeletePartModal(false)}
                className="flex-1 px-4 py-2 bg-slate-200 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 rounded-xl font-semibold hover:bg-slate-300 dark:hover:bg-slate-700/70 transition-all"
                disabled={isDeletingPart}
              >
                Cancel
              </button>
              <button
                onClick={handleDeletePart}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-xl font-semibold transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={isDeletingPart}
              >
                {isDeletingPart ? 'Deleting...' : 'Delete Part'}
              </button>
            </div>
          </div>
        </div>
      )}

      <AddPartModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={() => {
          loadParts();
          refreshAdminAuditFeeds();
        }}
      />

      {selectedPart && (
        <AdjustQuantityModal
          isOpen={isAdjustModalOpen}
          onClose={() => setIsAdjustModalOpen(false)}
          onSuccess={(updated) => {
            loadParts();
            refreshAdminAuditFeeds();
            setSelectedPart((prev) =>
              prev && prev.id === updated.id
                ? { ...prev, quantity: updated.quantity, updatedAt: updated.updatedAt ?? prev.updatedAt }
                : prev,
            );
            void loadPartDetailUnified(updated.id);
          }}
          part={selectedPart}
        />
      )}

      {selectedPart && (
        <EditPartModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          onSuccess={() => {
            loadParts();
            refreshAdminAuditFeeds();
            setShowPartDetails(false);
          }}
          part={selectedPart}
        />
      )}
      {isAccessDenied && (
        <AccessDeniedOverlay message="You do not have permission to view Inventory." />
      )}
    </div>
  );
}
