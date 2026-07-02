"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import DashboardSidebar from "@/components/DashboardSidebar";
import AccessDeniedOverlay from "@/components/AccessDeniedOverlay";
import EstimateSectionCard from "@/components/estimate/EstimateSectionCard";
import EstimateSummarySection from "@/components/estimate/EstimateSummarySection";
import EstimateVariantSwitcher from "@/components/estimate/EstimateVariantSwitcher";
import EstimateConfigurableSelect from "@/components/estimate/EstimateConfigurableSelect";
import EstimateConfidenceScale from "@/components/estimate/EstimateConfidenceScale";
import WonContractPriceModal from "@/components/estimate/WonContractPriceModal";
import {
  EstimateEditorPermissionsProvider,
  resolveEstimateEditorPermissions,
  useEstimateEditorPermissions,
} from "@/components/estimate/EstimateEditorPermissionsContext";
import { isEstimateTabEnabled } from "@/lib/featureFlags";
import { usePermissions } from "@/lib/hooks/usePermissions";
import type {
  EstimateCatalogRow,
  EstimateChangeOrder,
  EstimateComputed,
  EstimateDraft,
  EstimateSummarySection as EstimateSummaryNumbers,
  EstimateVariantSummary,
  EstimateVendorAdjustmentRule,
  EstimateVisibleMaterialLine,
  EstimateWorkbookSectionRow,
  StandaloneEstimateBidStatus,
  StandaloneEstimateDetail,
} from "@/lib/estimateTypes";
import {
  draftPercentToDisplay,
  normalizeDraftPercent,
  SALES_TYPE_OPTIONS,
  validateMetadataForSent,
} from "@/lib/estimate/estimateMetadata";
import {
  buildMaterialCatalogRowMetadata,
  SUBS_MISC_CUSTOM_CELLS,
  SUBS_MISC_FIXED_LABELS,
  SYSTEM1_DESIGN_INPUT_CELL_MAP,
  SYSTEM1_FIELD_INPUT_CELL_MAP,
  SYSTEM1_RATE_INPUT_CELL_MAP,
  SYSTEM1_SHOP_INPUT_CELL_MAP,
} from "@/lib/estimate/system1Template";
import { SYNTHETIC_PUMP_BUNDLE_ROW_KEY } from "@/lib/estimate/system1AutoChildRules";
import {
  SYSTEM1_SECTION_ADJUSTMENT_RULES,
  parseSheetRowFromCatalogKey,
} from "@/lib/estimate/system1SectionAdjustments";
import {
  estimateAccentBadge,
  estimateBadge,
  estimateBodyTextMuted,
  estimatePrimaryButton,
  estimatePrimaryButtonMd,
  estimateToolbarButton,
  estimateViewToggleActive,
  estimateViewToggleGroup,
  estimateViewToggleInactive,
  estimateCatalogBadgeEditable,
  estimateCatalogBadgeFormula,
  estimateCatalogGroupHeader,
  estimateCatalogGroupTitle,
  estimateCatalogModalFilterLabel,
  estimateCatalogModalHeader,
  estimateCatalogModalPanel,
  estimateCatalogModalToolbar,
  estimateDropdownItem,
  estimateDropdownItemActive,
  estimateDropdownItemSm,
  estimateDropdownMenu,
  estimateDropdownMenuSm,
  estimateInputFieldCompact,
  estimateInputFieldCompactSm,
  estimateInventoryResultsPanel,
  estimateLabelCompact,
  estimateModalCancelBtn,
  estimateModalCloseBtn,
  estimateModalDescription,
  estimateModalOverlay,
  estimateModalPanel,
  estimateModalTitle,
  estimateSecondaryButton,
  estimateSecondaryButtonSm,
  estimateTableBody,
  estimateTableHead,
  estimateTableWrap,
  estimateTotalsPanel,
  estimateWorkbookShell,
  estimateWorkbookTabActive,
  estimateWorkbookTabInactive,
  estimateWorkbookTabList,
  estimateGreenCell,
  estimateGreenCellSheet,
  estimateLockedValue,
  estimatePricingFieldGrid,
  estimatePricingInput,
  estimatePricingInputWithSuffix,
  estimatePricingLabel,
  estimatePricingReadonly,
  estimatePricingReadonlyAccent,
  estimatePricingSection,
  estimatePricingSectionTitle,
  estimateWorkbookNumberInput,
  estimateWorkbookPanel,
  estimateWorkbookRestoreBtn,
  estimateWorkbookStat,
  estimateWorkbookTableBody,
  estimateWorkbookTableDivide,
  estimateWorkbookTableHead,
  estimateWorkbookTableHeader,
  estimateWorkbookTitle,
  estimateWorkbookToolbar,
  estimateWorkbookTotalLabel,
  estimateWorkbookTotalRow,
  estimateYellowInputChanged,
  estimateYellowInputDefault,
  estimateYellowInputStatic,
} from "@/lib/estimate/estimateUi";

const PUMP_BUNDLE_SIZES = [4, 6, 8, 10] as const;

function getFieldWorkbookCellDefault(cell: string): unknown {
  const normalizedCell = normalizeCellAddress(cell);
  if (Object.prototype.hasOwnProperty.call(SYSTEM1_RATE_INPUT_CELL_MAP, normalizedCell)) {
    return (SYSTEM1_RATE_INPUT_CELL_MAP as Record<string, unknown>)[normalizedCell];
  }
  if (Object.prototype.hasOwnProperty.call(SYSTEM1_FIELD_INPUT_CELL_MAP, normalizedCell)) {
    return (SYSTEM1_FIELD_INPUT_CELL_MAP as Record<string, unknown>)[normalizedCell];
  }
  return undefined;
}

function getShopWorkbookCellDefault(cell: string): unknown {
  const normalizedCell = normalizeCellAddress(cell);
  if (Object.prototype.hasOwnProperty.call(SYSTEM1_SHOP_INPUT_CELL_MAP, normalizedCell)) {
    return (SYSTEM1_SHOP_INPUT_CELL_MAP as Record<string, unknown>)[normalizedCell];
  }
  return undefined;
}

function getDesignWorkbookCellDefault(cell: string): unknown {
  const normalizedCell = normalizeCellAddress(cell);
  if (Object.prototype.hasOwnProperty.call(SYSTEM1_DESIGN_INPUT_CELL_MAP, normalizedCell)) {
    return (SYSTEM1_DESIGN_INPUT_CELL_MAP as Record<string, unknown>)[normalizedCell];
  }
  return undefined;
}

const DEFAULT_VARIANT_KEY = "base";
const STANDALONE_BID_STATUSES: StandaloneEstimateBidStatus[] = [
  "DRAFT",
  "SENT",
  "WON",
  "LOST",
  "ARCHIVED",
];

type SaveState = "idle" | "saving" | "saved" | "error";
type SectionKey = "project" | "materials" | "pricing" | "changeOrders";
type StatusMenuPosition = "open" | "closed";
type EstimateView = "summary" | "workbook";
type WorkbookTab = "material" | "field" | "shop" | "design" | "subsMisc";

type PartSearchResult = {
  rowKey: string;
  sheetRow: number;
  section: string;
  subcategory: string | null;
  partNumber: string;
  description: string | null;
  uom: string | null;
  vendor: string | null;
  cost: number | null;
  quantity: number | null;
  quantityCell: string | null;
  unitCostCell: string | null;
  isFormula: boolean;
  rowType: string;
};

type MaterialForm = {
  partNumber: string;
  description: string;
  vendor: string;
  quantity: number;
  unitCost: string;
};

function createInitialSaveState(): Record<SectionKey, SaveState> {
  return {
    project: "idle",
    materials: "idle",
    pricing: "idle",
    changeOrders: "idle",
  };
}

function bidStatusLabel(status: StandaloneEstimateBidStatus | string | null | undefined) {
  if (status === "SENT") return "Sent";
  if (status === "WON") return "Won";
  if (status === "LOST") return "Lost";
  if (status === "ARCHIVED") return "Archived";
  return "Draft";
}

function bidStatusClassName(status: StandaloneEstimateBidStatus | string | null | undefined) {
  if (status === "SENT") return "border-blue-400/40 bg-blue-50 text-blue-800 dark:bg-blue-500/10 dark:text-blue-200";
  if (status === "WON") return "border-emerald-400/40 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200";
  if (status === "LOST") return "border-rose-400/40 bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-200";
  if (status === "ARCHIVED") return "border-slate-400/60 bg-slate-100 text-slate-700 dark:border-slate-500/60 dark:bg-slate-700/40 dark:text-slate-200";
  return "border-amber-500/50 bg-amber-100 text-amber-950 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200";
}

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatExactCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function sanitizeCatalogText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // A few catalog rows historically stored a workbook formula in the label
  // slot (e.g. row 938's column-A formula leaked in). Never render that as a
  // human-readable name.
  if (trimmed.startsWith("=")) return null;
  return trimmed;
}

function catalogRowToSearchResult(row: EstimateCatalogRow): PartSearchResult {
  const cleanLabel = sanitizeCatalogText(row.label);
  const cleanDescription = sanitizeCatalogText(row.description);
  const cleanDetail = sanitizeCatalogText(row.detail);
  const descriptionParts = [cleanDescription, cleanDetail].filter(
    (value, index, values): value is string =>
      Boolean(value) && values.findIndex((candidate) => candidate === value) === index,
  );
  return {
    rowKey: row.rowKey,
    sheetRow: row.sheetRow,
    section: row.section,
    subcategory: row.subcategory,
    partNumber: cleanLabel || cleanDescription || `Row ${row.sheetRow}`,
    description: descriptionParts.join(" - ") || cleanLabel,
    uom: null,
    vendor: row.section,
    cost: row.unitCost ?? row.defaultUnitCost,
    quantity: row.quantity,
    quantityCell: row.quantityCell,
    unitCostCell: row.unitCostCell,
    isFormula: Boolean(row.formulaKey),
    rowType: row.rowType,
  };
}

function makeLineKey(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nextRowIndex(draft: EstimateDraft) {
  return (
    draft.materials.visibleLines.reduce(
      (max, line) => Math.max(max, Number(line.rowIndex) || 0),
      0,
    ) + 1
  );
}

function numberOrNull(value: string) {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function normalizeCellAddress(cell: string) {
  return cell.trim().toUpperCase();
}

function valuesMatchDefault(value: unknown, defaultValue: unknown) {
  const left = Number(value);
  const right = Number(defaultValue);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return value === defaultValue;
  return Math.abs(left - right) < 0.0001;
}

function createEstimateLine(params: {
  draft: EstimateDraft;
  partNumber: string | null;
  description: string | null;
  quantity: number;
  vendor: string | null;
  unitCost: number | null;
  prefix: string;
  catalogRowKey?: string | null;
  catalogQuantityCell?: string | null;
  catalogUnitCostCell?: string | null;
  isCatalogFormula?: boolean | null;
}): EstimateVisibleMaterialLine {
  const manualQty = Math.max(0, params.quantity || 0);
  return {
    lineKey: makeLineKey(params.prefix),
    autoSource: null,
    catalogRowKey: params.catalogRowKey ?? null,
    catalogQuantityCell: params.catalogQuantityCell ?? null,
    catalogUnitCostCell: params.catalogUnitCostCell ?? null,
    isCatalogFormula: params.isCatalogFormula ?? false,
    rowIndex: nextRowIndex(params.draft),
    partNumber: params.partNumber?.trim() || null,
    description: params.description?.trim() || null,
    manualQty,
    autoQty: 0,
    effectiveQuantity: manualQty,
    supplier: params.vendor?.trim() || null,
    databaseUnitPrice:
      params.catalogRowKey && typeof params.unitCost === "number" && Number.isFinite(params.unitCost)
        ? Math.max(0, params.unitCost)
        : null,
    manualUnitPrice:
      !params.catalogRowKey && typeof params.unitCost === "number" && Number.isFinite(params.unitCost)
        ? Math.max(0, params.unitCost)
        : null,
    baseUnitPrice: null,
    vendorAdjustmentPercent: null,
    adjustedUnitPrice: null,
    resolvedUnitPrice: null,
    priceSource: "missing",
    blockingReason: null,
    lineTotal: null,
  };
}

function saveStateLabel(state: SaveState) {
  if (state === "saving") return "Saving...";
  if (state === "saved") return "Saved";
  if (state === "error") return "Save failed";
  return "Ready";
}

export default function StandaloneEstimateEditor({ estimateId }: { estimateId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const { hasPermission, isLoading: permissionsLoading, isSuperAdmin, isDeveloper } =
    usePermissions();
  const canAccess =
    isEstimateTabEnabled() && hasPermission("estimates.view");
  const editorPermissions = useMemo(
    () =>
      resolveEstimateEditorPermissions(hasPermission, {
        elevated: isSuperAdmin || isDeveloper,
      }),
    [hasPermission, isDeveloper, isSuperAdmin],
  );
  const {
    canEditInfo,
    canEditWorkbook,
    canEditPricing,
    canChangeStatus,
    canGeneratePdf,
    canManageVariants,
  } = editorPermissions;
  const canSavePricingDraft = canEditWorkbook || canEditPricing;

  const [detail, setDetail] = useState<StandaloneEstimateDetail | null>(null);
  const [draft, setDraftState] = useState<EstimateDraft | null>(null);
  const [computed, setComputed] = useState<EstimateComputed | null>(null);
  const [variants, setVariants] = useState<EstimateVariantSummary[]>([]);
  const [activeVariantKey, setActiveVariantKey] = useState(DEFAULT_VARIANT_KEY);
  const [statusMenu, setStatusMenu] = useState<StatusMenuPosition>("closed");
  const [sheetMenuOpen, setSheetMenuOpen] = useState(false);
  const [activeView, setActiveView] = useState<EstimateView>("summary");
  const [activeWorkbookTab, setActiveWorkbookTab] = useState<WorkbookTab>("material");
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isPricingControlsModalOpen, setIsPricingControlsModalOpen] = useState(false);
  const [isWonModalOpen, setIsWonModalOpen] = useState(false);
  const [isWonModalSubmitting, setIsWonModalSubmitting] = useState(false);
  const [wonModalError, setWonModalError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isVariantBusy, setIsVariantBusy] = useState(false);
  const [saveStates, setSaveStates] = useState<Record<SectionKey, SaveState>>(
    createInitialSaveState(),
  );
  const recalcTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduledSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sheetMenuRef = useRef<HTMLDivElement | null>(null);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);
  const hasLoadedDetailRef = useRef(false);
  const latestDraftRef = useRef<EstimateDraft | null>(null);
  const lastSavedDraftJsonRef = useRef<string>("");
  const lastSavingDraftJsonRef = useRef<string>("");
  const pendingSaveSectionRef = useRef<SectionKey | null>(null);

  const setDraft = useCallback((next: SetStateAction<EstimateDraft | null>) => {
    const resolved =
      typeof next === "function"
        ? (next as (current: EstimateDraft | null) => EstimateDraft | null)(
            latestDraftRef.current,
          )
        : next;
    latestDraftRef.current = resolved;
    setDraftState(resolved);
  }, []);

  const selectedEstimate = detail?.estimate ?? null;
  const listBackPath = useMemo(() => {
    const from = searchParams?.get("from");
    if (from === "archive") return "/estimates/archive";
    if (from === "active") return "/estimates";
    const bidStatus = detail?.estimate.bidStatus;
    if (bidStatus === "WON" || bidStatus === "LOST" || bidStatus === "ARCHIVED") {
      return "/estimates/archive";
    }
    return "/estimates";
  }, [detail?.estimate.bidStatus, searchParams]);
  const isSavingAny = Object.values(saveStates).some((state) => state === "saving");
  const hasSaveError = Object.values(saveStates).some((state) => state === "error");
  const recentlySavedAny = Object.values(saveStates).some((state) => state === "saved");
  const firstBlockingReason = computed?.parity.issues[0]?.message ?? null;

  useEffect(() => {
    if (status === "loading" || permissionsLoading) return;
    if (!session) {
      router.push(`/login?callbackUrl=/estimates/${encodeURIComponent(estimateId)}`);
      return;
    }
    if (!canAccess) return;
    void loadEstimate(estimateId, DEFAULT_VARIANT_KEY);
  }, [session, status, permissionsLoading, canAccess, router, estimateId]);

  useEffect(() => {
    if (!draft || !hasLoadedDetailRef.current) return;
    if (!canSavePricingDraft) return;
    if (recalcTimerRef.current) clearTimeout(recalcTimerRef.current);
    recalcTimerRef.current = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/estimates/${encodeURIComponent(estimateId)}/recalculate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ draft }),
          },
        );
        if (!response.ok) return;
        const payload = await response.json();
        setComputed(payload.computed);
      } catch (recalcError) {
        console.error("Standalone estimate recalculation failed:", recalcError);
      }
    }, 250);

    return () => {
      if (recalcTimerRef.current) clearTimeout(recalcTimerRef.current);
    };
  }, [canSavePricingDraft, draft, estimateId]);

  useEffect(() => {
    if (!sheetMenuOpen && statusMenu === "closed") return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const clickedSheetMenu = sheetMenuRef.current?.contains(target) ?? false;
      const clickedStatusMenu = statusMenuRef.current?.contains(target) ?? false;
      if (!clickedSheetMenu) setSheetMenuOpen(false);
      if (!clickedStatusMenu) setStatusMenu("closed");
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSheetMenuOpen(false);
      setStatusMenu("closed");
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [sheetMenuOpen, statusMenu]);

  const loadVariants = async (estimateId: string) => {
    const response = await fetch(
      `/api/estimates/${encodeURIComponent(estimateId)}/variants`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      setVariants([]);
      return;
    }
    const payload = await response.json();
    setVariants(payload.variants || []);
  };

  const loadEstimate = async (estimateId: string, variantKey = activeVariantKey) => {
    setIsDetailLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/estimates/${encodeURIComponent(estimateId)}?variantKey=${encodeURIComponent(
          variantKey,
        )}`,
        { cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to load estimate");
      setDetail(payload);
      setDraft(payload.variant.data);
      setComputed(payload.computed);
      lastSavedDraftJsonRef.current = JSON.stringify(payload.variant.data);
      setActiveVariantKey(payload.variant.variantKey || variantKey);
      hasLoadedDetailRef.current = true;
      await loadVariants(estimateId);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setIsDetailLoading(false);
    }
  };

  const updateSaveState = (section: SectionKey, state: SaveState) => {
    setSaveStates((current) => ({ ...current, [section]: state }));
  };

  const buildEstimateSaveBody = useCallback(
    (section: SectionKey, draftToSave: EstimateDraft) => {
      const useInfoOnlySave =
        section === "project" &&
        canEditInfo &&
        !canEditWorkbook &&
        !canSavePricingDraft;

      return {
        variantKey: activeVariantKey,
        ...(useInfoOnlySave
          ? { saveMode: "info" as const, draft: { project: draftToSave.project } }
          : { draft: draftToSave }),
        title: detail?.estimate.title,
        projectName: draftToSave.project.projectName,
        projectNumber: draftToSave.project.systemLabel,
        locationLine1: draftToSave.project.projectLocationLine1,
        locationLine2: draftToSave.project.projectLocationLine2,
      };
    },
    [activeVariantKey, canEditInfo, canEditWorkbook, canSavePricingDraft, detail?.estimate.title],
  );

  const saveDraftForSection = useCallback(
    async (section: SectionKey) => {
      const canSaveSection =
        section === "materials"
          ? canEditWorkbook
          : section === "project"
            ? canEditInfo
            : canSavePricingDraft;
      if (!canSaveSection) return;
      const draftToSave = latestDraftRef.current;
      if (!draftToSave || !detail) return;
      const draftJson = JSON.stringify(draftToSave);
      if (
        draftJson === lastSavedDraftJsonRef.current ||
        draftJson === lastSavingDraftJsonRef.current
      ) {
        return;
      }
      lastSavingDraftJsonRef.current = draftJson;
      updateSaveState(section, "saving");
      setError(null);
      try {
        const response = await fetch(`/api/estimates/${encodeURIComponent(estimateId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildEstimateSaveBody(section, draftToSave)),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Failed to save estimate");
        setDetail(payload);
        setDraft(payload.variant.data);
        setComputed(payload.computed);
        lastSavedDraftJsonRef.current = JSON.stringify(payload.variant.data);
        updateSaveState(section, "saved");
        void loadVariants(estimateId);
        window.setTimeout(() => updateSaveState(section, "idle"), 1200);
      } catch (saveError) {
        updateSaveState(section, "error");
        setError((saveError as Error).message);
      } finally {
        if (lastSavingDraftJsonRef.current === draftJson) {
          lastSavingDraftJsonRef.current = "";
        }
      }
    },
    [buildEstimateSaveBody, detail, estimateId, setDraft],
  );

  const saveDraftSnapshotForSection = useCallback(
    async (section: SectionKey, nextDraft: EstimateDraft) => {
      const canSaveSection =
        section === "materials"
          ? canEditWorkbook
          : section === "project"
            ? canEditInfo
            : canSavePricingDraft;
      if (!canSaveSection) return;
      if (!detail) return;
      const draftJson = JSON.stringify(nextDraft);
      if (
        draftJson === lastSavedDraftJsonRef.current ||
        draftJson === lastSavingDraftJsonRef.current
      ) {
        return;
      }
      lastSavingDraftJsonRef.current = draftJson;
      updateSaveState(section, "saving");
      setError(null);
      try {
        const response = await fetch(`/api/estimates/${encodeURIComponent(estimateId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildEstimateSaveBody(section, nextDraft)),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Failed to save estimate");
        setDetail(payload);
        setDraft(payload.variant.data);
        setComputed(payload.computed);
        lastSavedDraftJsonRef.current = JSON.stringify(payload.variant.data);
        updateSaveState(section, "saved");
        void loadVariants(estimateId);
        window.setTimeout(() => updateSaveState(section, "idle"), 1200);
      } catch (saveError) {
        updateSaveState(section, "error");
        setError((saveError as Error).message);
      } finally {
        if (lastSavingDraftJsonRef.current === draftJson) {
          lastSavingDraftJsonRef.current = "";
        }
      }
    },
    [buildEstimateSaveBody, detail, estimateId, setDraft],
  );

  const scheduleSaveForSection = useCallback(
    (section: SectionKey) => {
      pendingSaveSectionRef.current = section;
      if (scheduledSaveTimerRef.current) clearTimeout(scheduledSaveTimerRef.current);
      scheduledSaveTimerRef.current = setTimeout(() => {
        const pendingSection = pendingSaveSectionRef.current;
        pendingSaveSectionRef.current = null;
        scheduledSaveTimerRef.current = null;
        if (pendingSection) void saveDraftForSection(pendingSection);
      }, 50);
    },
    [saveDraftForSection],
  );

  const activeWorkbookSection = useCallback(
    (): SectionKey => (activeWorkbookTab === "material" ? "materials" : "pricing"),
    [activeWorkbookTab],
  );

  const updateDraftMaterials = (
    updater: (draft: EstimateDraft) => EstimateDraft,
    options?: { persist?: boolean },
  ) => {
    if (!canEditWorkbook) return;
    let nextDraft: EstimateDraft | null = null;
    setDraft((current) => {
      if (!current) return current;
      nextDraft = updater(current);
      return nextDraft;
    });
    if (options?.persist) {
      window.setTimeout(() => {
        if (nextDraft) void saveDraftSnapshotForSection("materials", nextDraft);
      }, 0);
    }
  };

  const addInventoryMaterial = (params: {
    part: PartSearchResult;
    quantity: number;
    manualUnitCost?: number | null;
  }) => {
    updateDraftMaterials(
      (current) => ({
        ...current,
        materials: {
          ...current.materials,
          workbookCatalog: {
            rows: current.materials.workbookCatalog?.rows?.length
              ? current.materials.workbookCatalog.rows
              : buildMaterialCatalogRowMetadata(),
            cellOverrides: {
              ...(current.materials.workbookCatalog?.cellOverrides ?? {}),
              ...(params.part.quantityCell
                ? { [params.part.quantityCell]: params.quantity }
                : {}),
              ...(params.part.unitCostCell && !params.part.isFormula && params.manualUnitCost !== null && params.manualUnitCost !== undefined
                ? { [params.part.unitCostCell]: params.manualUnitCost }
                : {}),
            },
          },
          visibleLines: [
            ...current.materials.visibleLines,
            createEstimateLine({
              draft: current,
              partNumber: params.part.partNumber,
              description: params.part.description,
              quantity: params.quantity,
              vendor: params.part.vendor,
              unitCost: params.part.isFormula ? params.part.cost ?? null : params.manualUnitCost ?? params.part.cost ?? null,
              prefix: "part",
              catalogRowKey: params.part.rowKey,
              catalogQuantityCell: params.part.quantityCell,
              catalogUnitCostCell: params.part.unitCostCell,
              isCatalogFormula: params.part.isFormula,
            }),
          ],
        },
      }),
      { persist: true },
    );
  };

  const addCustomMaterial = (params: {
    partNumber: string;
    description: string;
    vendor: string;
    quantity: number;
    unitCost: string;
  }) => {
    if (!params.partNumber.trim() && !params.description.trim()) {
      setError("Custom lines need a part number/name or description.");
      return;
    }
    updateDraftMaterials(
      (current) => ({
        ...current,
        materials: {
          ...current.materials,
          visibleLines: [
            ...current.materials.visibleLines,
            createEstimateLine({
              draft: current,
              partNumber: params.partNumber,
              description: params.description,
              quantity: params.quantity,
              vendor: params.vendor,
              unitCost: numberOrNull(params.unitCost),
              prefix: "custom",
            }),
          ],
        },
      }),
      { persist: true },
    );
  };

  const updateVisibleLine = (
    lineKey: string,
    updater: (line: EstimateVisibleMaterialLine) => EstimateVisibleMaterialLine,
  ) => {
    updateDraftMaterials(
      (current) => ({
        ...current,
        materials: {
          ...current.materials,
          visibleLines: current.materials.visibleLines.map((line) =>
            line.lineKey === lineKey ? updater(line) : line,
          ),
          workbookCatalog: (() => {
            const original = current.materials.visibleLines.find((line) => line.lineKey === lineKey);
            if (!original?.catalogRowKey) return current.materials.workbookCatalog;
            const updated = updater(original);
            return {
              rows: current.materials.workbookCatalog?.rows?.length
                ? current.materials.workbookCatalog.rows
                : buildMaterialCatalogRowMetadata(),
              cellOverrides: {
                ...(current.materials.workbookCatalog?.cellOverrides ?? {}),
                ...(updated.catalogQuantityCell
                  ? { [updated.catalogQuantityCell]: updated.manualQty }
                  : {}),
                ...(updated.catalogUnitCostCell && typeof updated.manualUnitPrice === "number"
                  ? { [updated.catalogUnitCostCell]: updated.manualUnitPrice }
                  : {}),
              },
            };
          })(),
        },
      }),
      { persist: true },
    );
  };

  const removeVisibleLine = (lineKey: string) => {
    updateDraftMaterials(
      (current) => {
        const removed = current.materials.visibleLines.find((line) => line.lineKey === lineKey);
        const survivingLines = current.materials.visibleLines.filter(
          (line) => line.lineKey !== lineKey,
        );
        const zeroedQuantityOverrides = removed?.catalogQuantityCell
          ? { [removed.catalogQuantityCell]: 0 }
          : {};
        const survivingSheetRows = new Set(
          survivingLines
            .map((line) => parseSheetRowFromCatalogKey(line.catalogRowKey))
            .filter((row): row is number => row !== null),
        );
        const baseOverrides = {
          ...(current.materials.workbookCatalog?.cellOverrides ?? {}),
          ...zeroedQuantityOverrides,
        };
        SYSTEM1_SECTION_ADJUSTMENT_RULES.forEach((rule) => {
          const stillTriggered = Array.from(survivingSheetRows).some(
            (row) => row >= rule.rangeStartSheetRow && row <= rule.rangeEndSheetRow,
          );
          if (!stillTriggered) {
            delete baseOverrides[rule.percentCell];
          }
        });
        return {
          ...current,
          materials: {
            ...current.materials,
            workbookCatalog: {
              rows: current.materials.workbookCatalog?.rows?.length
                ? current.materials.workbookCatalog.rows
                : buildMaterialCatalogRowMetadata(),
              cellOverrides: baseOverrides,
            },
            visibleLines: survivingLines,
          },
        };
      },
      { persist: true },
    );
  };

  const setSectionAdjustmentPercent = (cell: string, percent: number | null) => {
    updateDraftMaterials(
      (current) => {
        const existing = current.materials.workbookCatalog?.cellOverrides ?? {};
        const next = { ...existing };
        const normalizedCell = cell.trim().toUpperCase();
        if (percent === null || !Number.isFinite(percent) || percent === 0) {
          delete next[normalizedCell];
        } else {
          next[normalizedCell] = percent;
        }
        return {
          ...current,
          materials: {
            ...current.materials,
            workbookCatalog: {
              rows: current.materials.workbookCatalog?.rows?.length
                ? current.materials.workbookCatalog.rows
                : buildMaterialCatalogRowMetadata(),
              cellOverrides: next,
            },
          },
        };
      },
      { persist: true },
    );
  };

  const flushPendingProjectSave = useCallback(() => {
    if (scheduledSaveTimerRef.current) {
      clearTimeout(scheduledSaveTimerRef.current);
      scheduledSaveTimerRef.current = null;
    }
    if (pendingSaveSectionRef.current === "project") {
      pendingSaveSectionRef.current = null;
    }
  }, []);

  const handleProjectModalDone = useCallback(async () => {
    flushPendingProjectSave();
    if (canEditInfo) {
      await saveDraftForSection("project");
    }
    setIsProjectModalOpen(false);
  }, [canEditInfo, flushPendingProjectSave, saveDraftForSection]);

  const handleProjectChange = (
    field: keyof EstimateDraft["project"] | keyof EstimateDraft["inputs"],
    value: string | number | null,
  ) => {
    const pricingInputFields = new Set<keyof EstimateDraft["inputs"]>([
      "salesTaxPercent",
      "materialInflationPercent",
      "overheadPercent",
      "profitPercent",
      "subsMarkupPercent",
      "milesToJobSite",
      "peStamp",
      "bondCost",
    ]);
    const pricingProjectFields = new Set<keyof EstimateDraft["project"]>(["squareFootage"]);
    const isPricingField =
      pricingInputFields.has(field as keyof EstimateDraft["inputs"]) ||
      pricingProjectFields.has(field as keyof EstimateDraft["project"]);
    if (isPricingField ? !canSavePricingDraft : !canEditInfo) return;
    setDraft((current) => {
      if (!current) return current;
      if (field in current.project) {
        return { ...current, project: { ...current.project, [field]: value } };
      }
      return { ...current, inputs: { ...current.inputs, [field]: value } };
    });
  };

  const handleProjectFieldsChange = (patch: Partial<EstimateDraft["project"]>) => {
    if (!canEditInfo) return;
    setDraft((current) =>
      current ? { ...current, project: { ...current.project, ...patch } } : current,
    );
  };

  const saveContractPrice = async (contractPrice: number) => {
    if (!canEditPricing || !detail) return;
    setError(null);
    try {
      const response = await fetch(`/api/estimates/${encodeURIComponent(estimateId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractPrice }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to save contract price");
      setDetail((current) =>
        current ? { ...current, estimate: payload.estimate } : current,
      );
    } catch (saveError) {
      setError((saveError as Error).message);
    }
  };

  const handleWorkbookCellChange = (
    section: "field" | "shop" | "design" | "subsAndFees",
    cell: string,
    value: number | string | null,
  ) => {
    if (!canEditWorkbook) return;
    setDraft((current) => {
      if (!current) return current;
      if (section === "field") {
        const normalizedCell = normalizeCellAddress(cell);
        if (normalizedCell === "I70") {
          return current;
        }
        const defaultFieldValue = getFieldWorkbookCellDefault(normalizedCell);
        if (defaultFieldValue !== undefined && valuesMatchDefault(value, defaultFieldValue)) {
          const nextManualHours = { ...current.field.manualHours };
          delete nextManualHours[normalizedCell];
          if (normalizedCell === "E66") {
            delete nextManualHours.I70;
          }
          return {
            ...current,
            field: {
              ...current.field,
              manualHours: nextManualHours,
            },
          };
        }
        const nextManualHours = { ...current.field.manualHours, [normalizedCell]: value };
        if (normalizedCell === "E66") {
          delete nextManualHours.I70;
        }
        return {
          ...current,
          field: {
            ...current.field,
            manualHours: nextManualHours,
          },
        };
      }
      if (section === "shop") {
        const normalizedCell = normalizeCellAddress(cell);
        const defaultShopValue = getShopWorkbookCellDefault(normalizedCell);
        if (defaultShopValue !== undefined && valuesMatchDefault(value, defaultShopValue)) {
          const nextInputs = { ...current.shop.inputs };
          delete nextInputs[normalizedCell];
          return {
            ...current,
            shop: { ...current.shop, inputs: nextInputs },
          };
        }
        return {
          ...current,
          shop: { ...current.shop, inputs: { ...current.shop.inputs, [normalizedCell]: value } },
        };
      }
      if (section === "design") {
        const normalizedCell = normalizeCellAddress(cell);
        const defaultDesignValue = getDesignWorkbookCellDefault(normalizedCell);
        if (defaultDesignValue !== undefined && valuesMatchDefault(value, defaultDesignValue)) {
          const nextInputs = { ...current.design.inputs };
          delete nextInputs[normalizedCell];
          return {
            ...current,
            design: { ...current.design, inputs: nextInputs },
          };
        }
        return {
          ...current,
          design: { ...current.design, inputs: { ...current.design.inputs, [normalizedCell]: value } },
        };
      }
      if (
        cell === "subsMarkupPercent" ||
        cell === "fees" ||
        cell === "peStamp" ||
        cell === "bondCost"
      ) {
        return {
          ...current,
          inputs: { ...current.inputs, [cell]: value },
        };
      }
      return {
        ...current,
        subsAndFees: {
          ...current.subsAndFees,
          miscellaneousCosts: {
            ...current.subsAndFees.miscellaneousCosts,
            [cell]: value,
          },
        },
      };
    });
  };

  const commitWorkbookCellChange = (
    section: "field" | "shop" | "design" | "subsAndFees",
    cell: string,
    value: number | string | null,
  ) => {
    if (!canEditWorkbook) return;
    let nextDraft: EstimateDraft | null = null;
    setDraft((current) => {
      if (!current) return current;
      if (section === "field") {
        const normalizedCell = normalizeCellAddress(cell);
        if (normalizedCell === "I70") {
          nextDraft = current;
          return nextDraft;
        }
        const defaultFieldValue = getFieldWorkbookCellDefault(normalizedCell);
        if (defaultFieldValue !== undefined && valuesMatchDefault(value, defaultFieldValue)) {
          const nextManualHours = { ...current.field.manualHours };
          delete nextManualHours[normalizedCell];
          if (normalizedCell === "E66") {
            delete nextManualHours.I70;
          }
          nextDraft = {
            ...current,
            field: {
              ...current.field,
              manualHours: nextManualHours,
            },
          };
          return nextDraft;
        }
        const nextManualHours = { ...current.field.manualHours, [normalizedCell]: value };
        if (normalizedCell === "E66") {
          delete nextManualHours.I70;
        }
        nextDraft = {
          ...current,
          field: {
            ...current.field,
            manualHours: nextManualHours,
          },
        };
        return nextDraft;
      }
      if (section === "shop") {
        const normalizedCell = normalizeCellAddress(cell);
        const defaultShopValue = getShopWorkbookCellDefault(normalizedCell);
        if (defaultShopValue !== undefined && valuesMatchDefault(value, defaultShopValue)) {
          const nextInputs = { ...current.shop.inputs };
          delete nextInputs[normalizedCell];
          nextDraft = {
            ...current,
            shop: { ...current.shop, inputs: nextInputs },
          };
          return nextDraft;
        }
        nextDraft = {
          ...current,
          shop: {
            ...current.shop,
            inputs: { ...current.shop.inputs, [normalizedCell]: value },
          },
        };
        return nextDraft;
      }
      if (section === "design") {
        const normalizedCell = normalizeCellAddress(cell);
        const defaultDesignValue = getDesignWorkbookCellDefault(normalizedCell);
        if (defaultDesignValue !== undefined && valuesMatchDefault(value, defaultDesignValue)) {
          const nextInputs = { ...current.design.inputs };
          delete nextInputs[normalizedCell];
          nextDraft = {
            ...current,
            design: { ...current.design, inputs: nextInputs },
          };
          return nextDraft;
        }
        nextDraft = {
          ...current,
          design: {
            ...current.design,
            inputs: { ...current.design.inputs, [normalizedCell]: value },
          },
        };
        return nextDraft;
      }
      nextDraft = current;
      return current;
    });
    window.setTimeout(() => {
      if (nextDraft) void saveDraftSnapshotForSection("pricing", nextDraft);
    }, 0);
  };

  const handleExportPdf = () => {
    if (!selectedEstimate || !canGeneratePdf) return;
    window.open(
      `/api/estimates/${encodeURIComponent(
        selectedEstimate.id,
      )}/pdf?variantKey=${encodeURIComponent(activeVariantKey)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const handleSubsLabelChange = (cell: string, value: string) => {
    if (!canEditWorkbook) return;
    setDraft((current) =>
      current
        ? {
            ...current,
            subsAndFees: {
              ...current.subsAndFees,
              miscellaneousLabels: {
                ...(current.subsAndFees.miscellaneousLabels ?? {}),
                [cell]: value,
              },
            },
          }
        : current,
    );
  };

  const handleVendorRuleChange = (
    id: string,
    patch: Partial<EstimateVendorAdjustmentRule>,
  ) => {
    updateDraftMaterials((current) => ({
      ...current,
      materials: {
        ...current.materials,
        vendorAdjustments: (current.materials.vendorAdjustments ?? []).map((rule) =>
          rule.id === id ? { ...rule, ...patch } : rule,
        ),
      },
    }));
  };

  const addVendorRule = () => {
    updateDraftMaterials((current) => ({
      ...current,
      materials: {
        ...current.materials,
        vendorAdjustments: [
          ...(current.materials.vendorAdjustments ?? []),
          { id: makeLineKey("rule"), vendor: "", percent: 0 },
        ],
      },
    }));
  };

  const removeVendorRule = (id: string) => {
    updateDraftMaterials((current) => ({
      ...current,
      materials: {
        ...current.materials,
        vendorAdjustments: (current.materials.vendorAdjustments ?? []).filter(
          (rule) => rule.id !== id,
        ),
      },
    }));
  };

  const handleAddChangeOrder = () => {
    setDraft((current) => {
      if (!current) return current;
      const next: EstimateChangeOrder = {
        id: makeLineKey("co"),
        title: "New change order",
        description: "",
        amount: 0,
        hours: null,
      };
      return { ...current, changeOrders: [...current.changeOrders, next] };
    });
  };

  const handleRemoveChangeOrder = (id: string) => {
    setDraft((current) =>
      current
        ? { ...current, changeOrders: current.changeOrders.filter((order) => order.id !== id) }
        : current,
    );
  };

  const handleChangeOrderChange = (
    id: string,
    patch: Partial<EstimateChangeOrder>,
  ) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            changeOrders: current.changeOrders.map((order) =>
              order.id === id ? { ...order, ...patch } : order,
            ),
          }
        : current,
    );
  };

  const handleSectionBlur = (
    section: SectionKey,
    _event: FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    scheduleSaveForSection(section);
  };

  const handleWorkbookTabChange = (tab: WorkbookTab) => {
    if (tab === activeWorkbookTab) return;
    scheduleSaveForSection(activeWorkbookSection());
    setActiveWorkbookTab(tab);
  };

  const handleViewChange = (view: EstimateView) => {
    if (view === activeView) return;
    if (activeView === "workbook") {
      scheduleSaveForSection(activeWorkbookSection());
    }
    setActiveView(view);
  };

  const updateBidStatus = async (bidStatus: StandaloneEstimateBidStatus) => {
    if (!canChangeStatus) return;
    setStatusMenu("closed");
    setError(null);

    if (bidStatus === "WON") {
      setWonModalError(null);
      setIsWonModalOpen(true);
      return;
    }

    if (bidStatus === "SENT" && draft) {
      const validation = validateMetadataForSent(draft);
      if (!validation.ok) {
        setError(
          `Complete estimate info before marking as Sent: ${validation.missingFields.join(", ")}`,
        );
        if (canEditInfo) setIsProjectModalOpen(true);
        return;
      }
    }

    try {
      const response = await fetch(`/api/estimates/${encodeURIComponent(estimateId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidStatus }),
      });
      const payload = await response.json();
      if (!response.ok) {
        if (Array.isArray(payload.missingFields) && payload.missingFields.length > 0) {
          setError(
            payload.error ||
              `Complete estimate info before marking as Sent: ${payload.missingFields.join(", ")}`,
          );
          if (canEditInfo) setIsProjectModalOpen(true);
          return;
        }
        throw new Error(payload.error || "Failed to update status");
      }
      setDetail((current) =>
        current ? { ...current, estimate: payload.estimate } : current,
      );
      if (bidStatus === "LOST" || bidStatus === "ARCHIVED") {
        router.push("/estimates/archive");
      }
    } catch (statusError) {
      setError((statusError as Error).message);
    }
  };

  const confirmWonStatus = async (contractPrice: number) => {
    if (!canChangeStatus) return;
    setIsWonModalSubmitting(true);
    setWonModalError(null);
    try {
      const response = await fetch(`/api/estimates/${encodeURIComponent(estimateId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidStatus: "WON", contractPrice }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to update status");
      setDetail((current) =>
        current ? { ...current, estimate: payload.estimate } : current,
      );
      setIsWonModalOpen(false);
      router.push("/estimates/archive");
    } catch (statusError) {
      setWonModalError((statusError as Error).message);
    } finally {
      setIsWonModalSubmitting(false);
    }
  };

  const handleSelectVariant = async (variantKey: string) => {
    if (variantKey === activeVariantKey) return;
    await saveDraftForSection(activeWorkbookSection());
    setActiveVariantKey(variantKey);
    await loadEstimate(estimateId, variantKey);
  };

  const handleCreateVariant = async (params: {
    variantKey: string;
    variantLabel: string;
    copyFromVariantKey: string | null;
  }) => {
    if (!canManageVariants) return;
    setIsVariantBusy(true);
    try {
      const response = await fetch(`/api/estimates/${encodeURIComponent(estimateId)}/variants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to create variant");
      await loadVariants(estimateId);
      await loadEstimate(estimateId, payload.variant.variantKey);
    } catch (variantError) {
      setError((variantError as Error).message);
    } finally {
      setIsVariantBusy(false);
    }
  };

  const handleRenameVariant = async (variantKey: string, label: string) => {
    if (!canManageVariants) return;
    setIsVariantBusy(true);
    try {
      const response = await fetch(
        `/api/estimates/${encodeURIComponent(estimateId)}/variants/${encodeURIComponent(
          variantKey,
        )}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to rename variant");
      await loadVariants(estimateId);
    } catch (variantError) {
      setError((variantError as Error).message);
    } finally {
      setIsVariantBusy(false);
    }
  };

  const handleDeleteVariant = async (variantKey: string) => {
    if (!canManageVariants) return;
    const visibleVariants = variants.filter((variant) => variant.variantStatus !== "archived");
    const isOnlySheet = visibleVariants.length <= 1;
    setIsVariantBusy(true);
    try {
      if (isOnlySheet) {
        const response = await fetch(`/api/estimates/${encodeURIComponent(estimateId)}`, {
          method: "DELETE",
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Failed to delete estimate");
        router.push(listBackPath);
        return;
      }

      const fallbackVariantKey =
        variants.find((variant) => variant.variantKey !== variantKey)?.variantKey ??
        DEFAULT_VARIANT_KEY;
      const response = await fetch(
        `/api/estimates/${encodeURIComponent(estimateId)}/variants/${encodeURIComponent(
          variantKey,
        )}`,
        { method: "DELETE" },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to delete variant");
      await loadVariants(estimateId);
      if (activeVariantKey === variantKey) await loadEstimate(estimateId, fallbackVariantKey);
    } catch (variantError) {
      setError((variantError as Error).message);
    } finally {
      setIsVariantBusy(false);
    }
  };

  if (status === "loading" || permissionsLoading) {
    return <div className="min-h-screen bg-gray-50 dark:bg-slate-950" />;
  }

  if (!session || !canAccess) {
    return (
      <div className="flex min-h-screen bg-gray-50 dark:bg-slate-900">
        <DashboardSidebar />
        <main className="pointer-events-none flex min-w-0 flex-1 select-none flex-col gap-4 overflow-hidden p-4 blur-sm opacity-60 md:p-6">
          <div className="h-20 rounded-xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60" />
          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1fr_22rem]">
            <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60" />
            <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60" />
          </div>
        </main>
        <AccessDeniedOverlay message="You do not have permission to view this estimate." />
      </div>
    );
  }

  return (
    <EstimateEditorPermissionsProvider value={editorPermissions}>
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-slate-900">
      <DashboardSidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden p-4 md:p-6">
        {error ? (
          <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {!selectedEstimate || !draft || !computed ? (
          <div className="flex min-h-[60vh] items-center justify-center">
            <div className="max-w-md text-center">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                {isDetailLoading ? "Loading estimate..." : "Estimate not found"}
              </h2>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800/70">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    Estimate Sheet
                  </div>
                  <h1 className="mt-1 text-3xl font-bold leading-tight text-slate-900 dark:text-white">
                    {draft.project.projectName || selectedEstimate.title || "Untitled Estimate"}
                  </h1>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
                    <span>System {draft.project.systemLabel || "Not set"}</span>
                    <span>{draft.project.projectLocationLine1 || "No location"}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void (async () => {
                        await saveDraftForSection(activeWorkbookSection());
                        router.push(listBackPath);
                      })();
                    }}
                    className={estimateToolbarButton}
                  >
                    Back
                  </button>
                  <div className={estimateViewToggleGroup}>
                    {(["summary", "workbook"] as EstimateView[]).map((view) => (
                      <button
                        key={view}
                        type="button"
                        onClick={() => handleViewChange(view)}
                        className={
                          activeView === view
                            ? estimateViewToggleActive
                            : estimateViewToggleInactive
                        }
                      >
                        {view === "summary" ? "Summary" : "Workbook"}
                      </button>
                    ))}
                  </div>
                  {canEditPricing ? (
                    <button
                      type="button"
                      onClick={() => setIsPricingControlsModalOpen(true)}
                      className={estimateToolbarButton}
                    >
                      Pricing Controls
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() =>
                      router.push(
                        `/estimates/material-catalog?estimateId=${encodeURIComponent(
                          estimateId,
                        )}&variantKey=${encodeURIComponent(activeVariantKey)}`,
                      )
                    }
                    className={estimateToolbarButton}
                  >
                    Material Catalog
                  </button>
                  {canEditInfo ? (
                    <button
                      type="button"
                      onClick={() => setIsProjectModalOpen(true)}
                      className={estimateToolbarButton}
                    >
                      Edit Info
                    </button>
                  ) : null}
                  <div ref={sheetMenuRef}>
                    <EstimateVariantSwitcher
                      variants={variants}
                      activeVariantKey={activeVariantKey}
                      onSelect={(variantKey) => void handleSelectVariant(variantKey)}
                      onCreate={handleCreateVariant}
                      onRename={handleRenameVariant}
                      onDelete={handleDeleteVariant}
                      canManage={canManageVariants}
                      isBusy={isVariantBusy}
                      isOpen={sheetMenuOpen}
                      onOpenChange={(open) => {
                        setSheetMenuOpen(open);
                        if (open) setStatusMenu("closed");
                      }}
                    />
                  </div>
                  {canChangeStatus ? (
                  <div ref={statusMenuRef} className="relative">
                    <button
                      type="button"
                      onClick={() =>
                        setStatusMenu((current) => {
                          const next = current === "open" ? "closed" : "open";
                          if (next === "open") setSheetMenuOpen(false);
                          return next;
                        })
                      }
                      className={`flex h-11 min-w-36 items-center justify-between gap-3 rounded-lg border px-4 text-left text-sm font-semibold shadow-sm transition hover:brightness-110 ${bidStatusClassName(
                        selectedEstimate.bidStatus,
                      )}`}
                    >
                      <span className="text-base leading-tight">
                        {bidStatusLabel(selectedEstimate.bidStatus)}
                      </span>
                      <svg
                        className={`h-4 w-4 shrink-0 transition-transform ${
                          statusMenu === "open" ? "rotate-180" : ""
                        }`}
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                    {statusMenu === "open" ? (
                      <div className={`absolute right-0 z-30 mt-2 w-56 ${estimateDropdownMenu}`}>
                        {STANDALONE_BID_STATUSES.map((statusOption) => {
                          const isCurrent = statusOption === selectedEstimate.bidStatus;
                          return (
                            <button
                              key={statusOption}
                              type="button"
                              onClick={() => void updateBidStatus(statusOption)}
                              className={isCurrent ? estimateDropdownItemActive : estimateDropdownItem}
                            >
                              <span
                                className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${bidStatusClassName(
                                  statusOption,
                                )}`}
                              >
                                {bidStatusLabel(statusOption)}
                              </span>
                              {isCurrent ? (
                                <span className="text-xs text-blue-700 dark:text-blue-300">Selected</span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                  ) : (
                    <div
                      className={`flex h-11 min-w-36 items-center justify-center rounded-lg border px-4 text-sm font-semibold shadow-sm ${bidStatusClassName(
                        selectedEstimate.bidStatus,
                      )}`}
                    >
                      {bidStatusLabel(selectedEstimate.bidStatus)}
                    </div>
                  )}
                  {canGeneratePdf && computed.parity.canExportPdf ? (
                    <button
                      type="button"
                      onClick={handleExportPdf}
                      className={`${estimatePrimaryButtonMd} !text-white`}
                    >
                      Export PDF
                    </button>
                  ) : canGeneratePdf ? (
                    <button
                      type="button"
                      disabled
                      title={firstBlockingReason || "Resolve missing prices before export."}
                      className="h-11 rounded-lg bg-slate-700 px-4 text-sm font-semibold text-slate-300 opacity-80"
                    >
                      PDF Blocked
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            {activeView === "summary" ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <EstimateSummarySection computed={computed} />
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-5">
                <WorkbookTabs
                  active={activeWorkbookTab}
                  onChange={handleWorkbookTabChange}
                >
                  {activeWorkbookTab === "material" ? (
                    <>
                      <ManualMaterialsSection
                        draft={draft}
                        computed={computed}
                        saveState={saveStates.materials}
                        onAddInventoryMaterial={addInventoryMaterial}
                        onAddCustomMaterial={addCustomMaterial}
                        onUpdateLine={updateVisibleLine}
                        onRemoveLine={removeVisibleLine}
                        onSectionAdjustmentPercentChange={setSectionAdjustmentPercent}
                      />
                    </>
                  ) : null}

                  {activeWorkbookTab === "field" ? (
                    <FieldCostSection
                      rows={computed.fieldRows}
                      summary={[
                        { label: "Hours", value: computed.summary.totalFieldHours, kind: "number" },
                        { label: "Cost", value: computed.summary.totalFieldCost, kind: "currency" },
                        { label: "Travel Zone", value: computed.summary.travelZone, kind: "number" },
                      ]}
                      onChange={handleWorkbookCellChange}
                      onCommit={commitWorkbookCellChange}
                      onBlur={(event) => handleSectionBlur("pricing", event)}
                      fieldInputOverrides={draft.field.manualHours ?? {}}
                    />
                  ) : null}
                  {activeWorkbookTab === "shop" ? (
                    <ShopCostSection
                      rows={computed.shopRows}
                      summary={[
                        { label: "Hours", value: computed.summary.totalShopHours, kind: "number" },
                        { label: "Cost", value: computed.summary.totalShopCost, kind: "currency" },
                      ]}
                      onChange={handleWorkbookCellChange}
                      onCommit={commitWorkbookCellChange}
                      onBlur={(event) => handleSectionBlur("pricing", event)}
                      shopInputOverrides={draft.shop?.inputs ?? {}}
                    />
                  ) : null}
                  {activeWorkbookTab === "design" ? (
                    <DesignCostSection
                      rows={computed.designRows}
                      summary={[
                        { label: "Hours", value: computed.summary.totalDesignHours, kind: "number" },
                        { label: "Cost", value: computed.summary.totalDesignCost, kind: "currency" },
                      ]}
                      onChange={handleWorkbookCellChange}
                      onCommit={commitWorkbookCellChange}
                      onBlur={(event) => handleSectionBlur("pricing", event)}
                      designInputOverrides={draft.design?.inputs ?? {}}
                    />
                  ) : null}

                  {activeWorkbookTab === "subsMisc" ? (
                    <SubsMiscSection
                      draft={draft}
                      summary={computed.summary}
                      onValueChange={handleWorkbookCellChange}
                      onLabelChange={handleSubsLabelChange}
                      onBlur={(event) => handleSectionBlur("pricing", event)}
                    />
                  ) : null}
                </WorkbookTabs>
              </div>
            )}
          </div>
        )}
      </main>

      {isPricingControlsModalOpen && draft && computed && typeof document !== "undefined"
        ? createPortal(
            <div
              className={estimateModalOverlay}
              onMouseDown={() => setIsPricingControlsModalOpen(false)}
            >
              <div
                className={`max-h-[90vh] w-full max-w-7xl ${estimateModalPanel}`}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
                  <div>
                    <h2 className={estimateModalTitle}>Pricing Controls</h2>
                    <p className={estimateModalDescription}>
                      Estimate-level markups, fees, and job inputs applied after materials are priced.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsPricingControlsModalOpen(false)}
                    className={estimateModalCloseBtn}
                  >
                    Done
                  </button>
                </div>
                <div className="max-h-[calc(90vh-6rem)] overflow-y-auto p-5">
                  <PricingControlsSection
                    draft={draft}
                    summary={computed.summary}
                    onChange={handleProjectChange}
                    onBlur={(event) => handleSectionBlur("pricing", event)}
                  />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {isProjectModalOpen && draft && typeof document !== "undefined"
        ? createPortal(
            <div
              className={estimateModalOverlay}
              onMouseDown={() => {
                flushPendingProjectSave();
                setIsProjectModalOpen(false);
              }}
            >
              <div
                className={`max-h-[90vh] w-full max-w-3xl overflow-y-auto p-5 ${estimateModalPanel}`}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <h2 className={estimateModalTitle}>Edit Estimate Info</h2>
                    <p className={estimateModalDescription}>
                      Update project metadata and estimate-level settings. Click Done to save.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleProjectModalDone()}
                    disabled={saveStates.project === "saving"}
                    className={estimateModalCloseBtn}
                  >
                    {saveStates.project === "saving" ? "Saving..." : "Done"}
                  </button>
                </div>
                <EditEstimateInfoForm
                  draft={draft}
                  saveState={saveStates.project}
                  bidStatus={selectedEstimate?.bidStatus ?? "DRAFT"}
                  contractPrice={selectedEstimate?.contractPrice ?? null}
                  canEditInfo={canEditInfo}
                  canEditPricing={canEditPricing}
                  onChange={handleProjectChange}
                  onProjectFieldsChange={handleProjectFieldsChange}
                  onConfidenceChange={(value) =>
                    handleProjectChange("confidenceLevel", value)
                  }
                  onContractPriceBlur={(value) => {
                    if (value === null) return;
                    void saveContractPrice(value);
                  }}
                />
              </div>
            </div>,
            document.body,
          )
        : null}

      <WonContractPriceModal
        isOpen={isWonModalOpen}
        estimatedTotal={detail?.variant.totalCost ?? computed?.summary.totalCost ?? null}
        isSubmitting={isWonModalSubmitting}
        error={wonModalError}
        onCancel={() => {
          if (isWonModalSubmitting) return;
          setIsWonModalOpen(false);
          setWonModalError(null);
        }}
        onConfirm={(contractPrice) => void confirmWonStatus(contractPrice)}
      />
    </div>
    </EstimateEditorPermissionsProvider>
  );
}

type ModalMode = "inventory" | "custom" | "edit" | null;

const EMPTY_MATERIAL_FORM: MaterialForm = {
  partNumber: "",
  description: "",
  vendor: "",
  quantity: 1,
  unitCost: "",
};

function ManualMaterialsSection({
  draft,
  computed,
  saveState,
  onAddInventoryMaterial,
  onAddCustomMaterial,
  onUpdateLine,
  onRemoveLine,
  onSectionAdjustmentPercentChange,
}: {
  draft: EstimateDraft;
  computed: EstimateComputed;
  saveState: SaveState;
  onAddInventoryMaterial: (params: {
    part: PartSearchResult;
    quantity: number;
    manualUnitCost?: number | null;
  }) => void;
  onAddCustomMaterial: (params: {
    partNumber: string;
    description: string;
    vendor: string;
    quantity: number;
    unitCost: string;
  }) => void;
  onUpdateLine: (
    lineKey: string,
    updater: (line: EstimateVisibleMaterialLine) => EstimateVisibleMaterialLine,
  ) => void;
  onRemoveLine: (lineKey: string) => void;
  onSectionAdjustmentPercentChange: (cell: string, percent: number | null) => void;
}) {
  const { canEditWorkbook } = useEstimateEditorPermissions();
  const lines = computed.visibleMaterialLines;
  const catalogRows = useMemo(() => {
    const rows = draft.materials.workbookCatalog?.rows?.length
      ? draft.materials.workbookCatalog.rows
      : buildMaterialCatalogRowMetadata();
    return rows
      .filter(
        (row) =>
          row.rowType !== "section_header" &&
          row.rowType !== "adjustment" &&
          row.rowType !== "subtotal" &&
          (row.quantityCell || row.rowKey === SYNTHETIC_PUMP_BUNDLE_ROW_KEY),
      )
      .map(catalogRowToSearchResult);
  }, [draft.materials.workbookCatalog?.rows]);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [actionLineKey, setActionLineKey] = useState<string | null>(null);
  const [menuLineKey, setMenuLineKey] = useState<string | null>(null);
  const [inventoryQuery, setInventoryQuery] = useState("");
  const [inventoryResults, setInventoryResults] = useState<PartSearchResult[]>([]);
  const [isSearchingInventory, setIsSearchingInventory] = useState(false);
  const [inventoryQuantity, setInventoryQuantity] = useState(1);
  const [inventoryManualCost, setInventoryManualCost] = useState("");
  const [form, setForm] = useState<MaterialForm>(EMPTY_MATERIAL_FORM);
  const [vendors, setVendors] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/parts/vendors");
        if (!response.ok) return;
        const payload = await response.json();
        if (!cancelled) setVendors(payload.vendors || []);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const actionLine = actionLineKey
    ? lines.find((line) => line.lineKey === actionLineKey) ?? null
    : null;

  const closeModal = () => {
    setModalMode(null);
    setActionLineKey(null);
    setInventoryQuery("");
    setInventoryResults([]);
    setInventoryQuantity(1);
    setInventoryManualCost("");
    setForm(EMPTY_MATERIAL_FORM);
  };

  const openInventoryModal = () => {
    setInventoryQuantity(1);
    setInventoryManualCost("");
    setModalMode("inventory");
  };

  const openCustomModal = () => {
    setForm(EMPTY_MATERIAL_FORM);
    setModalMode("custom");
  };

  const openEditModal = (line: EstimateVisibleMaterialLine) => {
    setActionLineKey(line.lineKey);
    setForm({
      partNumber: line.partNumber ?? "",
      description: line.description ?? "",
      vendor: line.supplier ?? "",
      quantity: line.manualQty ?? 0,
      unitCost:
        typeof line.manualUnitPrice === "number" && Number.isFinite(line.manualUnitPrice)
          ? String(line.manualUnitPrice)
          : "",
    });
    setModalMode("edit");
  };

  // Block adding the same catalog row twice manually. Auto-only rows
  // (autoSource === "rule") don't count — picking them turns the same row
  // into a manual+auto blend.
  const occupiedCatalogRowKeys = useMemo(
    () =>
      new Set(
        draft.materials.visibleLines
          .map((line) => line.catalogRowKey)
          .filter((key): key is string => Boolean(key)),
      ),
    [draft.materials.visibleLines],
  );

  useEffect(() => {
    if (modalMode !== "inventory") return;
    const query = inventoryQuery.trim().toLowerCase();
    if (query.length < 2) {
      setInventoryResults([]);
      return;
    }
    setIsSearchingInventory(true);
    const timer = window.setTimeout(() => {
      const terms = query.split(/\s+/).filter(Boolean);
      setInventoryResults(
        catalogRows
          .filter((row) => {
            if (occupiedCatalogRowKeys.has(row.rowKey)) return false;
            const haystack = [
              row.partNumber,
              row.description,
              row.section,
              row.subcategory,
              row.vendor,
              row.sheetRow,
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();
            return terms.every((term) => haystack.includes(term));
          })
          .slice(0, 40),
      );
      setIsSearchingInventory(false);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [catalogRows, inventoryQuery, modalMode, occupiedCatalogRowKeys]);

  const submitCustomParent = () => {
    onAddCustomMaterial({
      partNumber: form.partNumber,
      description: form.description,
      vendor: form.vendor,
      quantity: form.quantity,
      unitCost: form.unitCost,
    });
    closeModal();
  };

  const submitEdit = () => {
    if (!actionLine) return;
    // Auto-only rows aren't in the draft yet; promote them by adding a
    // manual entry with the user-set qty + unit cost override.
    if (actionLine.autoSource === "rule" && actionLine.catalogRowKey) {
      const part = catalogRows.find((p) => p.rowKey === actionLine.catalogRowKey);
      if (part) {
        onAddInventoryMaterial({
          part,
          quantity: form.quantity || 0,
          manualUnitCost: numberOrNull(form.unitCost),
        });
      }
      closeModal();
      return;
    }
    onUpdateLine(actionLine.lineKey, (current) => ({
      ...current,
      partNumber: form.partNumber.trim() || null,
      description: form.description.trim() || null,
      supplier: form.vendor.trim() || null,
      manualQty: form.quantity || 0,
      manualUnitPrice: numberOrNull(form.unitCost),
    }));
    closeModal();
  };

  const promoteAutoLineToManual = (catalogRowKey: string, manualQty: number) => {
    const part = catalogRows.find((p) => p.rowKey === catalogRowKey);
    if (!part) return;
    onAddInventoryMaterial({ part, quantity: manualQty, manualUnitCost: null });
  };

  const addInventoryPart = (part: PartSearchResult) => {
    onAddInventoryMaterial({
      part,
      quantity: inventoryQuantity,
      manualUnitCost: numberOrNull(inventoryManualCost),
    });
    closeModal();
  };

  const deleteLine = (line: EstimateVisibleMaterialLine) => {
    if (line.autoSource === "rule") return;
    if (!window.confirm("Delete this part?")) return;
    onRemoveLine(line.lineKey);
  };

  return (
    <>
      <EstimateSectionCard
        title="Materials"
        description="Review selected System 1 catalog parts, custom parts, and child materials."
        className="flex min-h-0 flex-1 flex-col"
        bodyClassName="flex min-h-0 flex-1 flex-col p-5"
        rightSlot={
          <div className="flex flex-wrap items-center gap-2">
            <div className={estimateAccentBadge}>
              Materials Total {formatExactCurrency(computed.summary.materialSubtotal)}
            </div>
            {canEditWorkbook ? (
            <>
            <button
              type="button"
              onClick={openCustomModal}
              className={estimateSecondaryButton}
            >
              Custom Part
            </button>
            <button
              type="button"
              onClick={openInventoryModal}
              className={`${estimatePrimaryButton} !text-white px-3 py-2`}
            >
              Add Part
            </button>
            </>
            ) : null}
          </div>
        }
      >
        <div className={estimateTableWrap}>
          <table className="h-full min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700/50">
            <thead className={estimateTableHead}>
              <tr>
                <th className="px-3 py-2">Part</th>
                <th className="px-3 py-2">Description / Vendor</th>
                <th className="px-3 py-2">Manual Qty</th>
                <th className="px-3 py-2">From Related</th>
                <th className="px-3 py-2">Total Qty</th>
                <th className="px-3 py-2">Base Cost</th>
                <th className="px-3 py-2">Final Cost</th>
                <th className="px-3 py-2 text-right">Line Total</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className={estimateTableBody}>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-slate-500">
                    No selected parts yet. Use Add Part or Custom Part to start the estimate.
                  </td>
                </tr>
              ) : (
                lines.map((line) => {
                  const isAutoOnly = line.autoSource === "rule";
                  const isPumpBundle = line.catalogRowKey === SYNTHETIC_PUMP_BUNDLE_ROW_KEY;
                  const autoQty = line.autoQty ?? 0;
                  // A row is "auto-tinted" if it has any auto contribution at
                  // all — whether it's a pure auto-only row or a manual row
                  // that's also being fed by triggering parents. Such rows
                  // can't be deleted (would orphan the triggers); the menu
                  // hides Delete by collapsing into a single Auto pill.
                  const hasAutoContribution = isAutoOnly || autoQty > 0;
                  return (
                    <tr key={line.lineKey} className={hasAutoContribution ? "bg-emerald-500/5" : ""}>
                      <td className="px-3 py-3 align-top">
                        {hasAutoContribution ? (
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
                            Auto
                          </div>
                        ) : null}
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {line.partNumber || "Custom Part"}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className={`min-w-[14rem] ${estimateBodyTextMuted}`}>
                          {line.description || "-"}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {line.supplier || "No vendor"}
                        </div>
                        {line.blockingReason ? (
                          <div className="mt-1 text-xs text-amber-300">{line.blockingReason}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 align-top">
                        {isPumpBundle ? (
                          <select
                            value={line.pumpSize ?? ""}
                            onChange={(event) => {
                              const next = event.target.value;
                              onUpdateLine(line.lineKey, (current) => ({
                                ...current,
                                pumpSize: next
                                  ? (Number(next) as 4 | 6 | 8 | 10)
                                  : null,
                              }));
                            }}
                            disabled={!canEditWorkbook}
                            className={estimateInputFieldCompact}
                          >
                            <option value="">Select size</option>
                            {PUMP_BUNDLE_SIZES.map((size) => (
                              <option key={size} value={size}>
                                {size}&quot; pump
                              </option>
                            ))}
                          </select>
                        ) : (
                          <ManualQtyInput
                            value={line.manualQty}
                            onCommit={(next) => {
                              if (isAutoOnly) {
                                if (next !== 0 && line.catalogRowKey) {
                                  promoteAutoLineToManual(line.catalogRowKey, next);
                                }
                                return;
                              }
                              onUpdateLine(line.lineKey, (current) => ({
                                ...current,
                                manualQty: next,
                              }));
                            }}
                          />
                        )}
                      </td>
                      <td className="px-3 py-3 align-top">
                        {autoQty > 0 ? (
                          <span className="font-semibold text-emerald-300">{autoQty}</span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top font-semibold text-slate-900 dark:text-white">
                        {isPumpBundle ? "—" : line.effectiveQuantity}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {formatExactCurrency(line.baseUnitPrice ?? line.databaseUnitPrice)}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {line.priceSource === "manual"
                            ? line.catalogRowKey
                              ? "Override"
                              : "Manual"
                            : line.isCatalogFormula
                              ? "Catalog formula"
                              : "Catalog"}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top font-semibold text-slate-900 dark:text-white">
                        {(() => {
                          if (isPumpBundle) return "—";
                          const unit = line.adjustedUnitPrice ?? line.resolvedUnitPrice;
                          if (unit === null || unit === undefined) return "—";
                          return formatExactCurrency(line.effectiveQuantity * unit);
                        })()}
                      </td>
                      <td className="px-3 py-3 align-top text-right font-semibold text-slate-900 dark:text-white">
                        {isPumpBundle ? "—" : formatExactCurrency(line.lineTotal)}
                      </td>
                      <td className="px-3 py-3 align-top text-right">
                        {canEditWorkbook ? (
                        <MaterialActionsMenu
                          line={line}
                          isOpen={menuLineKey === line.lineKey}
                          onToggle={() =>
                            setMenuLineKey((current) =>
                              current === line.lineKey ? null : line.lineKey,
                            )
                          }
                          onEdit={() => {
                            setMenuLineKey(null);
                            openEditModal(line);
                          }}
                          onDelete={
                            hasAutoContribution
                              ? undefined
                              : () => {
                                  setMenuLineKey(null);
                                  deleteLine(line);
                                }
                          }
                        />
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
              {computed.sectionAdjustments.length > 0
                ? computed.sectionAdjustments.map((adjustment) => (
                    <tr
                      key={adjustment.adjustmentRowKey}
                      className="bg-amber-500/5"
                    >
                      <td className="px-3 py-3 align-top">
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-300">
                          Section Adjustment
                        </div>
                        <div className="font-semibold text-slate-900 dark:text-white">{adjustment.label}</div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className={estimateBodyTextMuted}>
                          Bumps every line in this section by the percent you set.
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          Section subtotal {formatExactCurrency(adjustment.sectionSubtotal)}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={Number((adjustment.percent * 100).toFixed(2))}
                            onChange={(event) => {
                              const raw = Number(event.target.value);
                              const next =
                                Number.isFinite(raw) && raw > 0 ? raw / 100 : null;
                              onSectionAdjustmentPercentChange(
                                adjustment.percentCell,
                                next,
                              );
                            }}
                            disabled={!canEditWorkbook}
                            readOnly={!canEditWorkbook}
                            className="w-20 rounded-lg border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-white outline-none focus:border-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
                          />
                          <span className="text-sm text-slate-300">%</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top text-slate-500">—</td>
                      <td className="px-3 py-3 align-top text-slate-500">—</td>
                      <td className="px-3 py-3 align-top text-xs text-slate-500">
                        Section %
                      </td>
                      <td className="px-3 py-3 align-top text-slate-500">—</td>
                      <td className="px-3 py-3 align-top text-right font-semibold text-amber-200">
                        {formatExactCurrency(adjustment.amount)}
                      </td>
                      <td className="px-3 py-3 align-top text-right">
                        <span className="inline-block rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-200">
                          Auto
                        </span>
                      </td>
                    </tr>
                  ))
                : null}
            </tbody>
          </table>
        </div>
      </EstimateSectionCard>

      {modalMode && typeof document !== "undefined"
        ? createPortal(
        <div
          className={estimateModalOverlay}
          onMouseDown={closeModal}
        >
          <div
            className={`max-h-[90vh] w-full max-w-3xl overflow-y-auto p-5 ${estimateModalPanel}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {modalMode === "inventory" ? (
              <InventoryPickerModal
                title="Add Catalog Part"
                description="Search the copied System 1 catalog and pick a part to add as a parent line."
                quantity={inventoryQuantity}
                manualCost={inventoryManualCost}
                query={inventoryQuery}
                results={inventoryResults}
                isSearching={isSearchingInventory}
                onQuantityChange={setInventoryQuantity}
                onManualCostChange={setInventoryManualCost}
                onQueryChange={setInventoryQuery}
                onPick={addInventoryPart}
                onClose={closeModal}
              />
            ) : null}

            {modalMode === "custom" ? (
              <CustomPartModal
                form={form}
                vendors={vendors}
                onChange={setForm}
                onSubmit={submitCustomParent}
                onClose={closeModal}
              />
            ) : null}

            {modalMode === "edit" && actionLine ? (
              <EditMaterialModal
                line={actionLine}
                form={form}
                vendors={vendors}
                onChange={setForm}
                onSubmit={submitEdit}
                onClose={closeModal}
              />
            ) : null}
          </div>
        </div>,
            document.body,
          )
        : null}
    </>
  );
}

function ManualQtyInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (next: number) => void;
}) {
  const { canEditWorkbook } = useEstimateEditorPermissions();
  const [draftValue, setDraftValue] = useState<string>(String(value));
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Pull in external value changes only when the input isn't being typed in;
  // otherwise the user's in-progress edits get clobbered each recompute.
  useEffect(() => {
    if (document.activeElement === inputRef.current) return;
    setDraftValue(String(value));
  }, [value]);
  const commit = () => {
    if (!canEditWorkbook) return;
    const parsed = Number(draftValue);
    const cleaned = Number.isFinite(parsed) ? parsed : 0;
    if (cleaned !== value) onCommit(cleaned);
    setDraftValue(String(cleaned));
  };
  return (
    <input
      ref={inputRef}
      type="number"
      step="1"
      value={draftValue}
      onChange={(event) => {
        if (!canEditWorkbook) return;
        setDraftValue(event.target.value);
      }}
      onBlur={commit}
      disabled={!canEditWorkbook}
      readOnly={!canEditWorkbook}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
      className={`w-20 ${estimateInputFieldCompactSm} disabled:cursor-not-allowed disabled:opacity-60`}
    />
  );
}

function MaterialActionsMenu({
  isOpen,
  onToggle,
  onEdit,
  onDelete,
}: {
  line: EstimateVisibleMaterialLine;
  isOpen: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={onToggle}
        className={estimateSecondaryButtonSm}
      >
        Actions
      </button>
      {isOpen ? (
        <div className={`absolute right-0 z-20 mt-1 w-40 ${estimateDropdownMenuSm}`}>
          <button
            type="button"
            onClick={onEdit}
            className={estimateDropdownItemSm}
          >
            Edit
          </button>
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className="block w-full px-3 py-2 text-left text-sm text-red-300 hover:bg-red-500/10"
            >
              Delete
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function VendorSelect({
  value,
  vendors,
  onChange,
}: {
  value: string;
  vendors: string[];
  onChange: (value: string) => void;
}) {
  const normalized = value.trim().toLowerCase();
  const matchesKnown =
    normalized === "" || vendors.some((vendor) => vendor.toLowerCase() === normalized);
  const [customMode, setCustomMode] = useState(!matchesKnown);

  useEffect(() => {
    if (!matchesKnown) setCustomMode(true);
  }, [matchesKnown]);

  if (customMode) {
    return (
      <div className="grid gap-1">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Type vendor name"
          className={estimateInputFieldCompact}
        />
        <button
          type="button"
          onClick={() => {
            setCustomMode(false);
            onChange("");
          }}
          className="justify-self-start text-[11px] font-semibold text-blue-300 hover:text-blue-200"
        >
          Choose from vendor list
        </button>
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={(event) => {
        if (event.target.value === "__custom__") {
          setCustomMode(true);
          onChange("");
          return;
        }
        onChange(event.target.value);
      }}
      className={estimateInputFieldCompact}
    >
      <option value="">Select vendor</option>
      {vendors.map((vendor) => (
        <option key={vendor} value={vendor}>
          {vendor}
        </option>
      ))}
      <option value="__custom__">+ Add new vendor</option>
    </select>
  );
}

type DirectoryUser = { email: string; name: string | null; role: string };

function formatRoleLabel(role: string) {
  return role
    .toLowerCase()
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function EditEstimateInfoForm({
  draft,
  saveState,
  bidStatus,
  contractPrice,
  canEditInfo,
  canEditPricing,
  onChange,
  onProjectFieldsChange,
  onBlur,
  onConfidenceChange,
  onContractPriceBlur,
}: {
  draft: EstimateDraft;
  saveState: SaveState;
  bidStatus: StandaloneEstimateBidStatus;
  contractPrice: number | null;
  canEditInfo: boolean;
  canEditPricing: boolean;
  onChange: (
    field: keyof EstimateDraft["project"] | keyof EstimateDraft["inputs"],
    value: string | number | null,
  ) => void;
  onProjectFieldsChange: (patch: Partial<EstimateDraft["project"]>) => void;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
  onConfidenceChange: (value: EstimateDraft["project"]["confidenceLevel"]) => void;
  onContractPriceBlur?: (value: number | null) => void;
}) {
  const inputClass = estimateInputFieldCompact;
  const labelClass = estimateLabelCompact;
  const fieldDisabled = !canEditInfo;
  const [contractPriceInput, setContractPriceInput] = useState(
    contractPrice !== null && Number.isFinite(contractPrice) ? String(contractPrice) : "",
  );

  const [users, setUsers] = useState<DirectoryUser[]>([]);

  useEffect(() => {
    setContractPriceInput(
      contractPrice !== null && Number.isFinite(contractPrice) ? String(contractPrice) : "",
    );
  }, [contractPrice]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/users/for-access");
        if (!response.ok) return;
        const payload = await response.json();
        if (!cancelled) setUsers(payload.users || []);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const estimatorValue = draft.project.estimator || "";
  const matchedUser = users.find(
    (user) =>
      user.email === estimatorValue ||
      (user.name && user.name === estimatorValue),
  );
  const isLegacyValue = estimatorValue !== "" && !matchedUser;

  return (
    <div>
      <div className="mb-3 text-xs font-semibold text-slate-500">
        {saveStateLabel(saveState)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={`${labelClass} sm:col-span-2`}>
          Project Name
          <input
            value={draft.project.projectName}
            onChange={(event) => onChange("projectName", event.target.value)}
            onBlur={onBlur}
            disabled={fieldDisabled}
            readOnly={fieldDisabled}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          System Label
          <input
            value={draft.project.systemLabel}
            onChange={(event) => onChange("systemLabel", event.target.value)}
            onBlur={onBlur}
            placeholder="e.g. Base · Alt #1 · Demo"
            disabled={fieldDisabled}
            readOnly={fieldDisabled}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Estimator
          <select
            value={isLegacyValue ? "__legacy__" : estimatorValue}
            onChange={(event) => {
              const next = event.target.value;
              if (next === "__legacy__") return;
              onChange("estimator", next);
            }}
            onBlur={(event) => onBlur?.(event as unknown as FocusEvent<HTMLInputElement>)}
            disabled={fieldDisabled}
            className={inputClass}
          >
            <option value="">Select estimator</option>
            {users.map((user) => {
              const display = user.name || user.email;
              return (
                <option key={user.email} value={user.name || user.email}>
                  {display} · {formatRoleLabel(user.role)}
                </option>
              );
            })}
            {isLegacyValue ? (
              <option value="__legacy__">{estimatorValue} (not in directory)</option>
            ) : null}
          </select>
        </label>
        <label className={labelClass}>
          Estimate Date
          <input
            type="date"
            value={draft.project.date}
            onChange={(event) => onChange("date", event.target.value)}
            onBlur={onBlur}
            disabled={fieldDisabled}
            readOnly={fieldDisabled}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Bid Due Date
          <input
            type="date"
            value={draft.project.bidDueDate}
            onChange={(event) => onChange("bidDueDate", event.target.value)}
            onBlur={onBlur}
            disabled={fieldDisabled}
            readOnly={fieldDisabled}
            className={inputClass}
          />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          Location
          <input
            value={draft.project.projectLocationLine1}
            onChange={(event) => onChange("projectLocationLine1", event.target.value)}
            onBlur={onBlur}
            disabled={fieldDisabled}
            readOnly={fieldDisabled}
            className={inputClass}
          />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          Area / Notes
          <input
            value={draft.project.projectLocationLine2}
            onChange={(event) => onChange("projectLocationLine2", event.target.value)}
            onBlur={onBlur}
            disabled={fieldDisabled}
            readOnly={fieldDisabled}
            className={inputClass}
          />
        </label>

        <EstimateConfigurableSelect
          label="Building Type"
          category="building_type"
          optionId={draft.project.buildingTypeOptionId}
          otherValue={draft.project.buildingTypeOther}
          inputClassName={inputClass}
          allowAddOptions={canEditInfo}
          disabled={fieldDisabled}
          onChange={(value) =>
            onProjectFieldsChange({
              buildingTypeOptionId: value.optionId,
              buildingTypeOther: value.other,
            })
          }
          onBlur={(event) => onBlur?.(event as unknown as FocusEvent<HTMLInputElement>)}
        />
        <EstimateConfigurableSelect
          label="Job Type"
          category="job_type"
          optionId={draft.project.jobTypeOptionId}
          otherValue={draft.project.jobTypeOther}
          inputClassName={inputClass}
          allowAddOptions={canEditInfo}
          disabled={fieldDisabled}
          onChange={(value) =>
            onProjectFieldsChange({
              jobTypeOptionId: value.optionId,
              jobTypeOther: value.other,
            })
          }
          onBlur={(event) => onBlur?.(event as unknown as FocusEvent<HTMLInputElement>)}
        />
        <label className={labelClass}>
          Sales Type
          <select
            value={draft.project.salesType ?? ""}
            onChange={(event) =>
              onChange(
                "salesType",
                event.target.value === "COMPETITIVE" || event.target.value === "NEGOTIATED"
                  ? event.target.value
                  : null,
              )
            }
            onBlur={(event) => onBlur?.(event as unknown as FocusEvent<HTMLInputElement>)}
            disabled={fieldDisabled}
            className={inputClass}
          >
            <option value="">Select sales type</option>
            {SALES_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <EstimateConfidenceScale
          value={draft.project.confidenceLevel}
          allowClear={bidStatus === "DRAFT" && canEditInfo}
          disabled={fieldDisabled}
          onChange={onConfidenceChange}
        />
        {bidStatus === "WON" ? (
          <label className={`${labelClass} sm:col-span-2`}>
            Contract Price
            <input
              type="number"
              min="0"
              step="0.01"
              value={contractPriceInput}
              onChange={(event) => setContractPriceInput(event.target.value)}
              onBlur={() => {
                const parsed = Number(contractPriceInput);
                if (!Number.isFinite(parsed) || parsed <= 0) {
                  onContractPriceBlur?.(null);
                  return;
                }
                onContractPriceBlur?.(parsed);
              }}
              disabled={!canEditPricing}
              readOnly={!canEditPricing}
              className={inputClass}
            />
          </label>
        ) : null}
      </div>
    </div>
  );
}

const WORKBOOK_TABS: Array<{ key: WorkbookTab; label: string }> = [
  { key: "material", label: "Material Pricing" },
  { key: "field", label: "Field Cost" },
  { key: "shop", label: "Shop Cost" },
  { key: "design", label: "Design Cost" },
  { key: "subsMisc", label: "Subs & Misc" },
];

function WorkbookTabs({
  active,
  onChange,
  children,
}: {
  active: WorkbookTab;
  onChange: (tab: WorkbookTab) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" className={estimateWorkbookTabList}>
        {WORKBOOK_TABS.map((tab) => {
          const isActive = active === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(tab.key)}
              className={`relative -mb-px rounded-t-lg border px-4 py-2 text-sm font-semibold transition ${
                isActive
                  ? estimateWorkbookTabActive
                  : estimateWorkbookTabInactive
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div className={estimateWorkbookShell}>
        {children}
      </div>
    </div>
  );
}

const FIELD_PIPE_ROWS = [15, 16, 17, 18, 19, 20, 22, 23, 24, 25, 26, 27, 28];
const FIELD_CPVC_ROWS = [31, 32, 33, 34, 35, 36];
const FIELD_SPRINKLER_ROWS = [39, 40, 41, 42, 43, 44, 45, 46, 47];
const FIELD_MISC_ROWS = [49, 50, 51, 52, 53, 54, 55];
const FIELD_SPRINKLER_AND_MISC_ROWS = [...FIELD_SPRINKLER_ROWS, ...FIELD_MISC_ROWS];
const FIELD_MINUTES_EDITABLE_ROWS = [49, 50, 51, 52, 53, 54];
const FIELD_RATE_COLUMN_EDITABLE_ROWS = [55];
const FIELD_QUANTITY_EDITABLE_ROWS = [44];
const FIELD_LABOR_ROWS = [58, 59, 60, 61, 62];
const FIELD_EXPENSE_ROWS = [66, 67, 68, 69, 70, 71];

function rowByNumber(rows: EstimateWorkbookSectionRow[], rowNumber: number) {
  return rows.find((row) => row.rowKey === `row-${rowNumber}`) ?? null;
}

function presentWorkbookRow(row: EstimateWorkbookSectionRow | null): row is EstimateWorkbookSectionRow {
  return row !== null;
}

function parseWorkbookRowNumber(rowKey: string): number | null {
  const match = /^row-(\d+)$/.exec(rowKey);
  return match ? Number.parseInt(match[1], 10) : null;
}

function FieldCostSection({
  rows,
  summary,
  onChange,
  onCommit,
  onBlur,
  fieldInputOverrides = {},
}: {
  rows: EstimateWorkbookSectionRow[];
  summary: Array<{ label: string; value: number | null; kind: "number" | "currency" }>;
  onChange: (
    section: "field" | "shop" | "design" | "subsAndFees",
    cell: string,
    value: number | string | null,
  ) => void;
  onCommit: (
    section: "field" | "shop" | "design" | "subsAndFees",
    cell: string,
    value: number | string | null,
  ) => void;
  onBlur: (event: FocusEvent<HTMLInputElement>) => void;
  fieldInputOverrides?: Record<string, unknown>;
}) {
  return (
    <EstimateSectionCard
      title="Field Cost"
      description="Rows 13-72 from System 1. Green cells are locked calculations; yellow cells are optional inputs and adjustable rates."
      rightSlot={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {summary.map((item) => (
            <div
              key={item.label}
              className={estimateWorkbookStat}
            >
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                {item.label}
              </div>
              <div className="font-semibold text-slate-900 dark:text-white">
                {item.kind === "currency" ? formatExactCurrency(item.value) : item.value ?? "-"}
              </div>
            </div>
          ))}
        </div>
      }
    >
      <div className="space-y-4">
        <PipeFootageTable
          rows={FIELD_PIPE_ROWS.map((row) => rowByNumber(rows, row)).filter(presentWorkbookRow)}
          onCommit={onCommit}
          fieldInputOverrides={fieldInputOverrides}
        />
        <FieldProductionTable
          title="CPVC Joints"
          rows={FIELD_CPVC_ROWS.map((row) => rowByNumber(rows, row)).filter(presentWorkbookRow)}
          quantityLabel="Joints"
          driverLabel="Minutes / Joint"
          onCommit={onCommit}
          showRestoreDefaults
          onChange={onChange}
          onBlur={onBlur}
          fieldInputOverrides={fieldInputOverrides}
        />
        <FieldProductionTable
          title="Sprinklers"
          rows={FIELD_SPRINKLER_AND_MISC_ROWS.map((row) => rowByNumber(rows, row)).filter(presentWorkbookRow)}
          hiddenRowLabels={["R & R or Other"]}
          unitRateLabel="Rate"
          driverLabel="Sprinklers"
          minutesLabel="Minutes/Sprinkler"
          minutesEditableRowNumbers={FIELD_MINUTES_EDITABLE_ROWS}
          rateColumnEditableRowNumbers={FIELD_RATE_COLUMN_EDITABLE_ROWS}
          quantityEditableRowNumbers={FIELD_QUANTITY_EDITABLE_ROWS}
          restoreDefaultRowNumbers={FIELD_SPRINKLER_ROWS}
          onCommit={onCommit}
          showRestoreDefaults
          onChange={onChange}
          onBlur={onBlur}
          fieldInputOverrides={fieldInputOverrides}
        />
        <FieldManualLaborTable
          rows={FIELD_LABOR_ROWS.map((row) => rowByNumber(rows, row)).filter(presentWorkbookRow)}
          onChange={onChange}
          onBlur={onBlur}
        />
        <FieldExpenseTable
          rows={FIELD_EXPENSE_ROWS.map((row) => rowByNumber(rows, row)).filter(presentWorkbookRow)}
          onChange={onChange}
          onCommit={onCommit}
          onBlur={onBlur}
          fieldInputOverrides={fieldInputOverrides}
        />
      </div>
    </EstimateSectionCard>
  );
}

function FieldProductionTable({
  title,
  rows,
  quantityLabel = "Qty",
  driverLabel,
  unitRateLabel,
  minutesLabel,
  minutesEditableRowNumbers = [],
  rateColumnEditableRowNumbers = [],
  quantityEditableRowNumbers = [],
  restoreDefaultRowNumbers,
  hiddenRowLabels = [],
  onCommit,
  showRestoreDefaults = false,
  onChange,
  onBlur,
  fieldInputOverrides = {},
}: {
  title: string;
  rows: EstimateWorkbookSectionRow[];
  quantityLabel?: string;
  driverLabel: string;
  unitRateLabel?: string;
  minutesLabel?: string;
  minutesEditableRowNumbers?: number[];
  rateColumnEditableRowNumbers?: number[];
  quantityEditableRowNumbers?: number[];
  restoreDefaultRowNumbers?: number[];
  hiddenRowLabels?: string[];
  onCommit?: (
    section: "field" | "shop" | "design" | "subsAndFees",
    cell: string,
    value: number | string | null,
  ) => void;
  showRestoreDefaults?: boolean;
  onChange: (
    section: "field" | "shop" | "design" | "subsAndFees",
    cell: string,
    value: number | string | null,
  ) => void;
  onBlur: (event: FocusEvent<HTMLInputElement>) => void;
  fieldInputOverrides?: Record<string, unknown>;
}) {
  const { canEditWorkbook } = useEstimateEditorPermissions();
  const minutesEditableRows = useMemo(
    () => new Set(minutesEditableRowNumbers),
    [minutesEditableRowNumbers],
  );

  const rateColumnEditableRows = useMemo(
    () => new Set(rateColumnEditableRowNumbers),
    [rateColumnEditableRowNumbers],
  );

  const quantityEditableRows = useMemo(
    () => new Set(quantityEditableRowNumbers),
    [quantityEditableRowNumbers],
  );

  const restoreDefaultRows = useMemo(
    () => (restoreDefaultRowNumbers ? new Set(restoreDefaultRowNumbers) : null),
    [restoreDefaultRowNumbers],
  );

  const visibleRows = useMemo(() => {
    const hidden = new Set(hiddenRowLabels.map((label) => label.trim().toLowerCase()));
    return rows.filter((row) => !hidden.has(row.label.trim().toLowerCase()));
  }, [hiddenRowLabels, rows]);

  const restoreDefaults = () => {
    if (!onCommit) return;
    visibleRows.forEach((row) => {
      const rowNumber = parseWorkbookRowNumber(row.rowKey);
      if (restoreDefaultRows && (rowNumber === null || !restoreDefaultRows.has(rowNumber))) {
        return;
      }
      const cellsToReset: string[] = [];
      if (rowNumber !== null && minutesEditableRows.has(rowNumber)) {
        if (row.minutesCell) cellsToReset.push(row.minutesCell);
        else if (row.rateCell) cellsToReset.push(row.rateCell);
      } else if (row.rateCell) {
        cellsToReset.push(row.rateCell);
      }
      cellsToReset.forEach((cell) => {
        const normalizedCell = normalizeCellAddress(cell);
        const defaultValue = (SYSTEM1_RATE_INPUT_CELL_MAP as Record<string, number | null>)[normalizedCell];
        onCommit("field", normalizedCell, defaultValue ?? null);
      });
    });
  };

  const renderEditableCell = (
    cell: string,
    displayValue: number | string | null,
    options?: { trackDefault?: boolean },
  ) => {
    const trackDefault = options?.trackDefault !== false;
    const normalizedCell = normalizeCellAddress(cell);
    const defaultValue = trackDefault
      ? (getFieldWorkbookCellDefault(normalizedCell) as number | string | null | undefined)
      : undefined;
    const draftValue =
      normalizedCell in fieldInputOverrides ? fieldInputOverrides[normalizedCell] : displayValue;
    const visiblyAdjusted =
      trackDefault && defaultValue !== undefined
        ? !valuesMatchDefault(draftValue, defaultValue)
        : false;
    return (
      <DebouncedYellowCell
        value={draftValue as number | string | null}
        onChange={(value) => onChange("field", cell, value)}
        onBlur={onBlur}
        isChanged={visiblyAdjusted}
        defaultValue={
          trackDefault && typeof defaultValue === "number" ? defaultValue : undefined
        }
      />
    );
  };

  return (
    <div className={estimateWorkbookPanel}>
      <div className={estimateWorkbookTableHeader}>
        <div className={estimateWorkbookTitle}>{title}</div>
        {showRestoreDefaults && onCommit && canEditWorkbook ? (
          <button
            type="button"
            onClick={restoreDefaults}
            className={estimateWorkbookRestoreBtn}
          >
            Restore to Default
          </button>
        ) : null}
      </div>
      <table className={estimateWorkbookTableDivide}>
        <thead className={estimateWorkbookTableHead}>
          <tr>
            <th className="px-3 py-2">{quantityLabel}</th>
            <th className="px-3 py-2">Description</th>
            {unitRateLabel ? <th className="px-3 py-2">{unitRateLabel}</th> : null}
            <th className="px-3 py-2">{driverLabel}</th>
            <th className="px-3 py-2">Hours</th>
            <th className="px-3 py-2">Days</th>
            {minutesLabel ? <th className="px-3 py-2">{minutesLabel}</th> : null}
          </tr>
        </thead>
        <tbody className={estimateWorkbookTableBody}>
          {visibleRows.map((row) => {
            const rowNumber = parseWorkbookRowNumber(row.rowKey);
            const isMinutesEditable =
              rowNumber !== null && minutesEditableRows.has(rowNumber);
            const isRateColumnEditable =
              rowNumber !== null && rateColumnEditableRows.has(rowNumber);
            const isQuantityEditable =
              rowNumber !== null && quantityEditableRows.has(rowNumber);
            const minutesEditCell = row.minutesCell ?? row.rateCell;
            const minutesDisplayValue = row.minutes ?? row.rate;
            const sprinklersDisplayValue =
              isMinutesEditable && row.minutes && row.minutes > 0
                ? 96 / row.minutes
                : null;
            const rateColumnDisplayValue = row.unitRate ?? row.rate;

            return (
              <tr key={row.rowKey}>
                <td className="px-3 py-2">
                  {isQuantityEditable && row.quantityCell ? (
                    renderEditableCell(row.quantityCell, row.quantity ?? null, { trackDefault: false })
                  ) : (
                    <GreenCell
                      value={row.quantity}
                      cell={row.quantityCell}
                    />
                  )}
                </td>
                <td className="px-3 py-2 font-semibold text-slate-900 dark:text-white">{row.label}</td>
                {unitRateLabel ? (
                  <td className="px-3 py-2">
                    {isRateColumnEditable && row.rateCell ? (
                      renderEditableCell(row.rateCell, rateColumnDisplayValue ?? null)
                    ) : (
                      <GreenCell
                        value={row.unitRate}
                        cell={row.unitRateCell}
                        precision={3}
                      />
                    )}
                  </td>
                ) : null}
                <td className="px-3 py-2">
                  {isMinutesEditable || isRateColumnEditable ? (
                    <GreenCell value={sprinklersDisplayValue} precision={2} />
                  ) : row.rateCell ? (
                    renderEditableCell(row.rateCell, row.rate ?? null)
                  ) : (
                    <GreenCell value={null} />
                  )}
                </td>
                <td className="px-3 py-2">
                  <GreenCell
                    value={row.hours}
                    cell={row.hoursCell}
                  />
                </td>
                <td className="px-3 py-2">
                  <GreenCell
                    value={row.days}
                    cell={row.daysCell}
                  />
                </td>
                {minutesLabel ? (
                  <td className="px-3 py-2">
                    {isMinutesEditable && minutesEditCell ? (
                      renderEditableCell(minutesEditCell, minutesDisplayValue ?? null)
                    ) : (
                      <GreenCell
                        value={isRateColumnEditable ? null : row.minutes}
                        cell={row.minutesCell}
                        precision={2}
                      />
                    )}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PipeFootageTable({
  rows,
  onCommit,
  fieldInputOverrides,
}: {
  rows: EstimateWorkbookSectionRow[];
  onCommit: (
    section: "field" | "shop" | "design" | "subsAndFees",
    cell: string,
    value: number | string | null,
  ) => void;
  fieldInputOverrides: Record<string, unknown>;
}) {
  const restoreDefaults = () => {
    rows.forEach((row) => {
      if (!row.rateCell) return;
      const normalizedCell = normalizeCellAddress(row.rateCell);
      const defaultValue = (SYSTEM1_RATE_INPUT_CELL_MAP as Record<string, number | null>)[normalizedCell];
      onCommit("field", normalizedCell, defaultValue ?? null);
    });
  };

  return (
    <div className={estimateWorkbookPanel}>
      <div className={estimateWorkbookTableHeader}>
        <div className={estimateWorkbookTitle}>Pipe Footage</div>
        <button
          type="button"
          onClick={restoreDefaults}
          className={estimateWorkbookRestoreBtn}
        >
          Restore to Default
        </button>
      </div>
      <table className={estimateWorkbookTableDivide}>
        <thead className={estimateWorkbookTableHead}>
          <tr>
            <th className="px-3 py-2">Footage</th>
            <th className="px-3 py-2">Description</th>
            <th className="px-3 py-2">Feet/Hour</th>
            <th className="px-3 py-2">Hours</th>
            <th className="px-3 py-2">Days</th>
            <th className="px-3 py-2">Feet/16 Hours</th>
          </tr>
        </thead>
        <tbody className={estimateWorkbookTableBody}>
          {rows.map((row) => {
            const rateCellKey = row.rateCell ? normalizeCellAddress(row.rateCell) : null;
            const defaultRate =
              rateCellKey
                ? (SYSTEM1_RATE_INPUT_CELL_MAP as Record<string, number | null>)[rateCellKey] ?? null
                : null;
            const draftRateValue =
              rateCellKey && rateCellKey in fieldInputOverrides
                ? fieldInputOverrides[rateCellKey]
                : null;
            const displayRate =
              typeof draftRateValue === "number" || typeof draftRateValue === "string"
                ? draftRateValue
                : row.rate;
            const feetPerHour =
              typeof row.unitRate === "number" && Number.isFinite(row.unitRate)
                ? row.unitRate
                : displayRate === null || displayRate === undefined || displayRate === ""
                  ? 0
                  : Number.isFinite(Number(displayRate))
                    ? Number(displayRate) / 16
                    : 0;
            const visiblyAdjusted = !valuesMatchDefault(displayRate, defaultRate);
            return (
              <tr key={row.rowKey}>
                <td className="px-3 py-2">
                  <GreenCell value={row.quantity} />
                </td>
                <td className="px-3 py-2 font-semibold text-slate-900 dark:text-white">{row.label}</td>
                <td className="px-3 py-2">
                  <GreenCell
                    value={feetPerHour}
                    precision={3}
                  />
                </td>
                <td className="px-3 py-2">
                  <GreenCell value={row.hours} precision={0} />
                </td>
                <td className="px-3 py-2">
                  <GreenCell value={row.days} precision={0} />
                </td>
                <td
                  className="px-3 py-2"
                >
                  {row.rateCell ? (
                    <DebouncedYellowCell
                      value={displayRate}
                      onChange={(value) => onCommit("field", row.rateCell!, value)}
                      isChanged={visiblyAdjusted}
                      defaultValue={defaultRate}
                    />
                  ) : (
                    <GreenCell value={null} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FieldManualLaborTable({
  rows,
  onChange,
  onBlur,
}: {
  rows: EstimateWorkbookSectionRow[];
  onChange: (
    section: "field" | "shop" | "design" | "subsAndFees",
    cell: string,
    value: number | string | null,
  ) => void;
  onBlur: (event: FocusEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className={estimateWorkbookPanel}>
      <div className={`${estimateWorkbookTableHeader} text-sm font-bold text-slate-900 dark:text-white`}>
        Manual Field Labor
      </div>
      <table className={estimateWorkbookTableDivide}>
        <thead className={estimateWorkbookTableHead}>
          <tr>
            <th className="px-3 py-2">Extra Hours</th>
            <th className="px-3 py-2">Labor Item</th>
            <th className="px-3 py-2">Calculated Hours</th>
            <th className="px-3 py-2">Days</th>
          </tr>
        </thead>
        <tbody className={estimateWorkbookTableBody}>
          {rows.map((row) => (
            <tr key={row.rowKey}>
              <td className="px-3 py-2">
                {row.quantityCell ? (
                  <YellowCell
                    value={row.quantity}
                    onChange={(value) => onChange("field", row.quantityCell!, value)}
                    onBlur={onBlur}
                  />
                ) : null}
              </td>
              <td className="px-3 py-2 font-semibold text-slate-900 dark:text-white">{row.label}</td>
              <td className="px-3 py-2">
                <GreenCell
                  value={row.hours}
                  cell={row.hoursCell}
                />
              </td>
              <td className="px-3 py-2">
                <GreenCell
                  value={row.days}
                  cell={row.daysCell}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FieldExpenseTable({
  rows,
  onChange,
  onCommit,
  onBlur,
  fieldInputOverrides = {},
}: {
  rows: EstimateWorkbookSectionRow[];
  onChange: (
    section: "field" | "shop" | "design" | "subsAndFees",
    cell: string,
    value: number | string | null,
  ) => void;
  onCommit: (
    section: "field" | "shop" | "design" | "subsAndFees",
    cell: string,
    value: number | string | null,
  ) => void;
  onBlur: (event: FocusEvent<HTMLInputElement>) => void;
  fieldInputOverrides?: Record<string, unknown>;
}) {
  const isCellOverridden = (cell: string) =>
    cell in fieldInputOverrides &&
    fieldInputOverrides[cell] !== null &&
    fieldInputOverrides[cell] !== "";
  const mileageQtyOverridden = isCellOverridden("A67");
  const FIELD_EXPENSE_RESTORE_CELLS = [
    "A67",
    "A68",
    "A69",
    "A70",
    "A71",
    "E66",
    "E68",
    "E69",
    "E71",
    "H71",
  ];
  const restoreDefaults = () => {
    FIELD_EXPENSE_RESTORE_CELLS.forEach((cell) => {
      const def = getFieldWorkbookCellDefault(cell);
      const value = def === undefined ? null : (def as number | string | null);
      onCommit("field", cell, value);
    });
  };
  const fieldLaborRow = rows.find((row) => row.rowKey === "row-66");
  const fieldLaborRate =
    "E66" in fieldInputOverrides ? fieldInputOverrides.E66 : fieldLaborRow?.rate ?? null;

  return (
    <div className={estimateWorkbookPanel}>
      <div className={estimateWorkbookTableHeader}>
        <div className={estimateWorkbookTitle}>
          Field Expenses
        </div>
        <button
          type="button"
          onClick={restoreDefaults}
          className={estimateWorkbookRestoreBtn}
        >
          Restore to Default
        </button>
      </div>
      <table className={estimateWorkbookTableDivide}>
        <thead className={estimateWorkbookTableHead}>
          <tr>
            <th className="px-3 py-2">Qty / Driver</th>
            <th className="px-3 py-2">Item</th>
            <th className="px-3 py-2">Rate / Setting</th>
            <th className="px-3 py-2 text-right">Cost</th>
          </tr>
        </thead>
        <tbody className={estimateWorkbookTableBody}>
          {rows.map((row) => {
            const rowNumber = Number(row.rowKey.replace("row-", ""));
            const quantityEditable = rowNumber >= 67;
            const rateEditable =
              row.rateCell && row.rateCell !== "E67" && rowNumber !== 70;
            return (
              <tr key={row.rowKey}>
                <td className="px-3 py-2">
                  {row.quantityCell ? (
                    quantityEditable ? (
                      <DebouncedYellowCell
                        value={row.quantity}
                        onChange={(value) => onChange("field", row.quantityCell!, value)}
                        onBlur={onBlur}
                        isChanged={isCellOverridden(row.quantityCell!)}
                      />
                    ) : (
                      <GreenCell
                        value={row.hours}
                        cell={row.quantityCell ?? row.hoursCell}
                      />
                    )
                  ) : (
                    <GreenCell
                      value={row.hours}
                      cell={row.hoursCell}
                    />
                  )}
                </td>
                <td className="px-3 py-2 font-semibold text-slate-900 dark:text-white">{row.label}</td>
                <td className="px-3 py-2">
                  {rowNumber === 70 ? (
                    <GreenCell
                      value={
                        typeof fieldLaborRate === "number"
                          ? fieldLaborRate
                          : fieldLaborRate == null || fieldLaborRate === ""
                            ? null
                            : Number(fieldLaborRate)
                      }
                      cell={row.rateCell}
                    />
                  ) : rateEditable ? (
                    <DebouncedYellowCell
                      value={row.rate}
                      onChange={(value) => onChange("field", row.rateCell!, value)}
                      onBlur={onBlur}
                      isChanged={isCellOverridden(row.rateCell!)}
                    />
                  ) : (
                    <GreenCell
                      value={row.rate}
                      cell={row.rateCell}
                    />
                  )}
                </td>
                <td className="px-3 py-2 text-right font-semibold text-slate-900 dark:text-white">
                  <div className="flex justify-end">
                    <GreenCell
                      value={row.cost}
                      cell={row.costCell}
                      currency
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const SHOP_FAB_ROWS = [75, 76, 77, 78];
const SHOP_TRUCKING_ROWS = [80, 81, 82, 83];
const SHOP_FAB_RESTORE_CELLS = ["A75", "A76", "A77", "A78", "E75"];
const SHOP_TRUCKING_RESTORE_CELLS = [
  "A80",
  "A81",
  "A82",
  "A83",
  "E80",
  "E81",
  "E82",
  "H80",
  "I83",
];

function shopCellOverridden(cell: string, overrides: Record<string, unknown>) {
  if (!(cell in overrides)) return false;
  const val = overrides[cell];
  if (val === null || val === "") return false;
  const def = getShopWorkbookCellDefault(cell);
  if (def === null || def === undefined) return true;
  return !valuesMatchDefault(val, def);
}

function ShopCostSection({
  rows,
  summary,
  onChange,
  onCommit,
  onBlur,
  shopInputOverrides = {},
}: {
  rows: EstimateWorkbookSectionRow[];
  summary: Array<{ label: string; value: number | null; kind: "number" | "currency" }>;
  onChange: (
    section: "field" | "shop" | "design" | "subsAndFees",
    cell: string,
    value: number | string | null,
  ) => void;
  onCommit: (
    section: "field" | "shop" | "design" | "subsAndFees",
    cell: string,
    value: number | string | null,
  ) => void;
  onBlur: (event: FocusEvent<HTMLInputElement>) => void;
  shopInputOverrides?: Record<string, unknown>;
}) {
  return (
    <EstimateSectionCard
      title="Shop Cost"
      description="Rows 73-83 from System 1. Fabrication and trucking auto-calculate from upstream inputs; yellow cells indicate manual overrides."
      rightSlot={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {summary.map((item) => (
            <div
              key={item.label}
              className={estimateWorkbookStat}
            >
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                {item.label}
              </div>
              <div className="font-semibold text-slate-900 dark:text-white">
                {item.kind === "currency" ? formatExactCurrency(item.value) : item.value ?? "-"}
              </div>
            </div>
          ))}
        </div>
      }
    >
      <div className="space-y-4">
        <ShopFabricationTable
          rows={SHOP_FAB_ROWS.map((row) => rowByNumber(rows, row)).filter(presentWorkbookRow)}
          totalRow={rowByNumber(rows, 79)}
          onChange={onChange}
          onCommit={onCommit}
          onBlur={onBlur}
          shopInputOverrides={shopInputOverrides}
        />
        <ShopTruckingTable
          rows={SHOP_TRUCKING_ROWS.map((row) => rowByNumber(rows, row)).filter(presentWorkbookRow)}
          onChange={onChange}
          onCommit={onCommit}
          onBlur={onBlur}
          shopInputOverrides={shopInputOverrides}
        />
      </div>
    </EstimateSectionCard>
  );
}

function ShopFabricationTable({
  rows,
  totalRow,
  onChange,
  onCommit,
  onBlur,
  shopInputOverrides,
}: {
  rows: EstimateWorkbookSectionRow[];
  totalRow: EstimateWorkbookSectionRow | null;
  onChange: (
    section: "field" | "shop" | "design" | "subsAndFees",
    cell: string,
    value: number | string | null,
  ) => void;
  onCommit: (
    section: "field" | "shop" | "design" | "subsAndFees",
    cell: string,
    value: number | string | null,
  ) => void;
  onBlur: (event: FocusEvent<HTMLInputElement>) => void;
  shopInputOverrides: Record<string, unknown>;
}) {
  const restoreDefaults = () => {
    SHOP_FAB_RESTORE_CELLS.forEach((cell) => {
      const def = getShopWorkbookCellDefault(cell);
      const value = def === undefined ? null : (def as number | string | null);
      onCommit("shop", cell, value);
    });
  };

  return (
    <div className={estimateWorkbookPanel}>
      <div className={estimateWorkbookTableHeader}>
        <div className={estimateWorkbookTitle}>Fabrication</div>
        <button
          type="button"
          onClick={restoreDefaults}
          className={estimateWorkbookRestoreBtn}
        >
          Restore to Default
        </button>
      </div>
      <table className={estimateWorkbookTableDivide}>
        <thead className={estimateWorkbookTableHead}>
          <tr>
            <th className="px-3 py-2">Qty / Hours</th>
            <th className="px-3 py-2">Item</th>
            <th className="px-3 py-2">Rate</th>
            <th className="px-3 py-2 text-right">Cost</th>
          </tr>
        </thead>
        <tbody className={estimateWorkbookTableBody}>
          {rows.map((row) => {
            const rowNumber = Number(row.rowKey.replace("row-", ""));
            const isFabRateRow = rowNumber === 75;
            return (
              <tr key={row.rowKey}>
                <td className="px-3 py-2">
                  {row.quantityCell ? (
                    <DebouncedYellowCell
                      value={row.quantity}
                      onChange={(value) => onCommit("shop", row.quantityCell!, value)}
                      isChanged={shopCellOverridden(row.quantityCell, shopInputOverrides)}
                    />
                  ) : (
                    <GreenCell value={row.hours} cell={row.hoursCell} />
                  )}
                </td>
                <td className="px-3 py-2 font-semibold text-slate-900 dark:text-white">{row.label}</td>
                <td className="px-3 py-2">
                  {isFabRateRow && row.rateCell ? (
                    <DebouncedYellowCell
                      value={row.rate}
                      onChange={(value) => onCommit("shop", row.rateCell!, value)}
                      isChanged={shopCellOverridden(row.rateCell, shopInputOverrides)}
                    />
                  ) : (
                    <GreenCell value={row.rate} cell={row.rateCell} />
                  )}
                </td>
                <td className="px-3 py-2 text-right font-semibold text-slate-900 dark:text-white">
                  <div className="flex justify-end">
                    <GreenCell value={row.cost} cell={row.costCell} currency />
                  </div>
                </td>
              </tr>
            );
          })}
          {totalRow ? (
            <tr className={estimateWorkbookTotalRow}>
              <td className="px-3 py-2">
                <GreenCell value={totalRow.hours} cell={totalRow.hoursCell} />
              </td>
              <td className={`px-3 py-2 ${estimateWorkbookTotalLabel}`}>
                {totalRow.label}
              </td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2" />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function ShopTruckingTable({
  rows,
  onChange,
  onCommit,
  onBlur,
  shopInputOverrides,
}: {
  rows: EstimateWorkbookSectionRow[];
  onChange: (
    section: "field" | "shop" | "design" | "subsAndFees",
    cell: string,
    value: number | string | null,
  ) => void;
  onCommit: (
    section: "field" | "shop" | "design" | "subsAndFees",
    cell: string,
    value: number | string | null,
  ) => void;
  onBlur: (event: FocusEvent<HTMLInputElement>) => void;
  shopInputOverrides: Record<string, unknown>;
}) {
  const restoreDefaults = () => {
    SHOP_TRUCKING_RESTORE_CELLS.forEach((cell) => {
      const def = getShopWorkbookCellDefault(cell);
      const value = def === undefined ? null : (def as number | string | null);
      onCommit("shop", cell, value);
    });
  };

  const mileageRateValue =
    "H80" in shopInputOverrides
      ? (shopInputOverrides.H80 as number | string | null | undefined)
      : (getShopWorkbookCellDefault("H80") as number | string | null | undefined);
  const mphValue =
    "I83" in shopInputOverrides
      ? (shopInputOverrides.I83 as number | string | null | undefined)
      : (getShopWorkbookCellDefault("I83") as number | string | null | undefined);

  return (
    <div className={estimateWorkbookPanel}>
      <div className={estimateWorkbookTableHeader}>
        <div className={estimateWorkbookTitle}>Trucking &amp; Travel</div>
        <button
          type="button"
          onClick={restoreDefaults}
          className={estimateWorkbookRestoreBtn}
        >
          Restore to Default
        </button>
      </div>
      <div className={estimateWorkbookToolbar}>
        <label className="flex items-center gap-2">
          <span className="uppercase tracking-wide text-slate-500">Mileage Rate</span>
          <DebouncedYellowCell
            value={mileageRateValue}
            onChange={(value) => onCommit("shop", "H80", value)}
            isChanged={shopCellOverridden("H80", shopInputOverrides)}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="uppercase tracking-wide text-slate-500">MPH</span>
          <DebouncedYellowCell
            value={mphValue}
            onChange={(value) => onCommit("shop", "I83", value)}
            isChanged={shopCellOverridden("I83", shopInputOverrides)}
          />
        </label>
      </div>
      <table className={estimateWorkbookTableDivide}>
        <thead className={estimateWorkbookTableHead}>
          <tr>
            <th className="px-3 py-2">Qty / Driver</th>
            <th className="px-3 py-2">Item</th>
            <th className="px-3 py-2">Rate / Setting</th>
            <th className="px-3 py-2 text-right">Cost</th>
          </tr>
        </thead>
        <tbody className={estimateWorkbookTableBody}>
          {rows.map((row) => {
            const rowNumber = Number(row.rowKey.replace("row-", ""));
            const rateEditable = rowNumber === 81 || rowNumber === 82;
            return (
              <tr key={row.rowKey}>
                <td className="px-3 py-2">
                  {row.quantityCell ? (
                    <DebouncedYellowCell
                      value={row.quantity}
                      onChange={(value) => onCommit("shop", row.quantityCell!, value)}
                      isChanged={shopCellOverridden(row.quantityCell, shopInputOverrides)}
                    />
                  ) : (
                    <GreenCell value={row.hours} cell={row.hoursCell} />
                  )}
                </td>
                <td className="px-3 py-2 font-semibold text-slate-900 dark:text-white">{row.label}</td>
                <td className="px-3 py-2">
                  {rateEditable && row.rateCell ? (
                    <DebouncedYellowCell
                      value={row.rate}
                      onChange={(value) => onCommit("shop", row.rateCell!, value)}
                      isChanged={shopCellOverridden(row.rateCell, shopInputOverrides)}
                    />
                  ) : (
                    <GreenCell value={row.rate} cell={row.rateCell} />
                  )}
                </td>
                <td className="px-3 py-2 text-right font-semibold text-slate-900 dark:text-white">
                  <div className="flex justify-end">
                    <GreenCell value={row.cost} cell={row.costCell} currency />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const DESIGN_BASIS_ROWS = [86, 87];
const DESIGN_HOURS_ROWS = [88, 89, 90, 91, 92];
const DESIGN_TRIPS_ROWS = [93, 94, 95, 96];
const DESIGN_BASIS_RESTORE_CELLS = ["A86", "A87", "E86", "E87"];
const DESIGN_FIELD_HOURS_PERCENT_CELL = "E87";
const DESIGN_HOURS_RESTORE_CELLS = ["A88", "A89", "A90", "A91", "A92", "E88"];
const DESIGN_TRIPS_RESTORE_CELLS = [
  "A93",
  "A94",
  "A95",
  "A96",
  "E94",
  "E95",
  "E96",
  "H94",
  "I93",
];

function designCellOverridden(cell: string, overrides: Record<string, unknown>) {
  if (!(cell in overrides)) return false;
  const val = overrides[cell];
  if (val === null || val === "") return false;
  const def = getDesignWorkbookCellDefault(cell);
  if (def === null || def === undefined) return true;
  return !valuesMatchDefault(val, def);
}

function toDesignPercentDisplayValue(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return value;
  const numeric = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(numeric)) return value;
  return numeric > 1 && numeric <= 100 ? numeric : numeric * 100;
}

function toDesignPercentStoredValue(value: number | null) {
  return value === null ? null : value / 100;
}

function DesignCostSection({
  rows,
  summary,
  onChange,
  onCommit,
  onBlur,
  designInputOverrides = {},
}: {
  rows: EstimateWorkbookSectionRow[];
  summary: Array<{ label: string; value: number | null; kind: "number" | "currency" }>;
  onChange: (
    section: "field" | "shop" | "design" | "subsAndFees",
    cell: string,
    value: number | string | null,
  ) => void;
  onCommit: (
    section: "field" | "shop" | "design" | "subsAndFees",
    cell: string,
    value: number | string | null,
  ) => void;
  onBlur: (event: FocusEvent<HTMLInputElement>) => void;
  designInputOverrides?: Record<string, unknown>;
}) {
  return (
    <EstimateSectionCard
      title="Design Cost"
      description="Rows 85-97 from System 1. Calculation basis, design hours, and travel auto-derive; yellow cells indicate manual overrides."
      rightSlot={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {summary.map((item) => (
            <div
              key={item.label}
              className={estimateWorkbookStat}
            >
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                {item.label}
              </div>
              <div className="font-semibold text-slate-900 dark:text-white">
                {item.kind === "currency" ? formatExactCurrency(item.value) : item.value ?? "-"}
              </div>
            </div>
          ))}
        </div>
      }
    >
      <div className="space-y-4">
        <DesignBasisTable
          rows={DESIGN_BASIS_ROWS.map((row) => rowByNumber(rows, row)).filter(presentWorkbookRow)}
          onChange={onChange}
          onCommit={onCommit}
          onBlur={onBlur}
          designInputOverrides={designInputOverrides}
        />
        <DesignHoursTable
          rows={DESIGN_HOURS_ROWS.map((row) => rowByNumber(rows, row)).filter(presentWorkbookRow)}
          totalRow={rowByNumber(rows, 97)}
          onChange={onChange}
          onCommit={onCommit}
          onBlur={onBlur}
          designInputOverrides={designInputOverrides}
        />
        <DesignTripsTable
          rows={DESIGN_TRIPS_ROWS.map((row) => rowByNumber(rows, row)).filter(presentWorkbookRow)}
          onChange={onChange}
          onCommit={onCommit}
          onBlur={onBlur}
          designInputOverrides={designInputOverrides}
        />
      </div>
    </EstimateSectionCard>
  );
}

function DesignBasisTable({
  rows,
  onChange,
  onCommit,
  onBlur,
  designInputOverrides,
}: {
  rows: EstimateWorkbookSectionRow[];
  onChange: (
    section: "field" | "shop" | "design" | "subsAndFees",
    cell: string,
    value: number | string | null,
  ) => void;
  onCommit: (
    section: "field" | "shop" | "design" | "subsAndFees",
    cell: string,
    value: number | string | null,
  ) => void;
  onBlur: (event: FocusEvent<HTMLInputElement>) => void;
  designInputOverrides: Record<string, unknown>;
}) {
  const restoreDefaults = () => {
    DESIGN_BASIS_RESTORE_CELLS.forEach((cell) => {
      const def = getDesignWorkbookCellDefault(cell);
      const value = def === undefined ? null : (def as number | string | null);
      onCommit("design", cell, value);
    });
  };

  return (
    <div className={estimateWorkbookPanel}>
      <div className={estimateWorkbookTableHeader}>
        <div className="text-sm font-bold text-white">Calculation Basis</div>
        <button
          type="button"
          onClick={restoreDefaults}
          className={estimateWorkbookRestoreBtn}
        >
          Restore to Default
        </button>
      </div>
      <table className={estimateWorkbookTableDivide}>
        <thead className={estimateWorkbookTableHead}>
          <tr>
            <th className="px-3 py-2">Hours</th>
            <th className="px-3 py-2">Item</th>
            <th className="px-3 py-2">Setting</th>
            <th className="px-3 py-2">Days</th>
            <th className="px-3 py-2">Weeks</th>
          </tr>
        </thead>
        <tbody className={estimateWorkbookTableBody}>
          {rows.map((row) => {
            const rowNumber = Number(row.rowKey.replace("row-", ""));
            const settingLabel = rowNumber === 86 ? "Spr Per Hr" : "Field Hrs %";
            const weeksCell = `J${rowNumber}`;
            const rateCell = row.rateCell ? normalizeCellAddress(row.rateCell) : null;
            const isFieldHoursPercentSetting = rateCell === DESIGN_FIELD_HOURS_PERCENT_CELL;
            const rawRateValue =
              rateCell && rateCell in designInputOverrides
                ? (designInputOverrides[rateCell] as number | string | null | undefined)
                : row.rate;
            const displayedRateValue = isFieldHoursPercentSetting
              ? toDesignPercentDisplayValue(rawRateValue)
              : rawRateValue;
            return (
              <tr key={row.rowKey}>
                <td className="px-3 py-2">
                  {row.quantityCell ? (
                    <DebouncedYellowCell
                      value={row.quantity}
                      onChange={(value) => onChange("design", row.quantityCell!, value)}
                      onBlur={onBlur}
                      isChanged={designCellOverridden(row.quantityCell, designInputOverrides)}
                    />
                  ) : (
                    <GreenCell value={row.hours} cell={row.hoursCell} />
                  )}
                </td>
                <td className="px-3 py-2 font-semibold text-slate-900 dark:text-white">{row.label}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {row.rateCell ? (
                      <DebouncedYellowCell
                        value={displayedRateValue}
                        onChange={(value) =>
                          onChange(
                            "design",
                            row.rateCell!,
                            isFieldHoursPercentSetting
                              ? toDesignPercentStoredValue(value)
                              : value,
                          )
                        }
                        onBlur={onBlur}
                        isChanged={designCellOverridden(row.rateCell, designInputOverrides)}
                      />
                    ) : null}
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">
                      {settingLabel}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <GreenCell value={row.days} cell={row.daysCell} precision={1} />
                </td>
                <td className="px-3 py-2">
                  <GreenCell value={null} cell={weeksCell} precision={1} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DesignHoursTable({
  rows,
  totalRow,
  onChange,
  onCommit,
  onBlur,
  designInputOverrides,
}: {
  rows: EstimateWorkbookSectionRow[];
  totalRow: EstimateWorkbookSectionRow | null;
  onChange: (
    section: "field" | "shop" | "design" | "subsAndFees",
    cell: string,
    value: number | string | null,
  ) => void;
  onCommit: (
    section: "field" | "shop" | "design" | "subsAndFees",
    cell: string,
    value: number | string | null,
  ) => void;
  onBlur: (event: FocusEvent<HTMLInputElement>) => void;
  designInputOverrides: Record<string, unknown>;
}) {
  const restoreDefaults = () => {
    DESIGN_HOURS_RESTORE_CELLS.forEach((cell) => {
      const def = getDesignWorkbookCellDefault(cell);
      const value = def === undefined ? null : (def as number | string | null);
      onCommit("design", cell, value);
    });
  };

  return (
    <div className={estimateWorkbookPanel}>
      <div className={estimateWorkbookTableHeader}>
        <div className={estimateWorkbookTitle}>Design Hours</div>
        <button
          type="button"
          onClick={restoreDefaults}
          className={estimateWorkbookRestoreBtn}
        >
          Restore to Default
        </button>
      </div>
      <table className={estimateWorkbookTableDivide}>
        <thead className={estimateWorkbookTableHead}>
          <tr>
            <th className="px-3 py-2">Hours</th>
            <th className="px-3 py-2">Item</th>
            <th className="px-3 py-2">Rate</th>
            <th className="px-3 py-2 text-right">Cost</th>
          </tr>
        </thead>
        <tbody className={estimateWorkbookTableBody}>
          {rows.map((row) => {
            const rowNumber = Number(row.rowKey.replace("row-", ""));
            const isMainRateRow = rowNumber === 88;
            return (
              <tr key={row.rowKey}>
                <td className="px-3 py-2">
                  {row.quantityCell ? (
                    <DebouncedYellowCell
                      value={row.quantity}
                      onChange={(value) => onChange("design", row.quantityCell!, value)}
                      onBlur={onBlur}
                      isChanged={designCellOverridden(row.quantityCell, designInputOverrides)}
                    />
                  ) : (
                    <GreenCell value={row.hours} cell={row.hoursCell} />
                  )}
                </td>
                <td className="px-3 py-2 font-semibold text-slate-900 dark:text-white">{row.label}</td>
                <td className="px-3 py-2">
                  {isMainRateRow && row.rateCell ? (
                    <DebouncedYellowCell
                      value={row.rate}
                      onChange={(value) => onChange("design", row.rateCell!, value)}
                      onBlur={onBlur}
                      isChanged={designCellOverridden(row.rateCell, designInputOverrides)}
                    />
                  ) : (
                    <GreenCell value={row.rate} cell={row.rateCell} />
                  )}
                </td>
                <td className="px-3 py-2 text-right font-semibold text-slate-900 dark:text-white">
                  <div className="flex justify-end">
                    <GreenCell value={row.cost} cell={row.costCell} currency />
                  </div>
                </td>
              </tr>
            );
          })}
          {totalRow ? (
            <tr className={estimateWorkbookTotalRow}>
              <td className="px-3 py-2">
                <GreenCell value={totalRow.hours} cell={totalRow.hoursCell} />
              </td>
              <td className={`px-3 py-2 ${estimateWorkbookTotalLabel}`}>
                {totalRow.label}
              </td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2" />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function DesignTripsTable({
  rows,
  onChange,
  onCommit,
  onBlur,
  designInputOverrides,
}: {
  rows: EstimateWorkbookSectionRow[];
  onChange: (
    section: "field" | "shop" | "design" | "subsAndFees",
    cell: string,
    value: number | string | null,
  ) => void;
  onCommit: (
    section: "field" | "shop" | "design" | "subsAndFees",
    cell: string,
    value: number | string | null,
  ) => void;
  onBlur: (event: FocusEvent<HTMLInputElement>) => void;
  designInputOverrides: Record<string, unknown>;
}) {
  const restoreDefaults = () => {
    DESIGN_TRIPS_RESTORE_CELLS.forEach((cell) => {
      const def = getDesignWorkbookCellDefault(cell);
      const value = def === undefined ? null : (def as number | string | null);
      onCommit("design", cell, value);
    });
  };

  const mileageRateValue =
    "H94" in designInputOverrides
      ? (designInputOverrides.H94 as number | string | null | undefined)
      : (getDesignWorkbookCellDefault("H94") as number | string | null | undefined);
  const mphValue =
    "I93" in designInputOverrides
      ? (designInputOverrides.I93 as number | string | null | undefined)
      : (getDesignWorkbookCellDefault("I93") as number | string | null | undefined);

  return (
    <div className={estimateWorkbookPanel}>
      <div className={estimateWorkbookTableHeader}>
        <div className={estimateWorkbookTitle}>Travel &amp; Trips</div>
        <button
          type="button"
          onClick={restoreDefaults}
          className={estimateWorkbookRestoreBtn}
        >
          Restore to Default
        </button>
      </div>
      <div className={estimateWorkbookToolbar}>
        <label className="flex items-center gap-2">
          <span className="uppercase tracking-wide text-slate-500">Mileage Rate</span>
          <DebouncedYellowCell
            value={mileageRateValue}
            onChange={(value) => onChange("design", "H94", value)}
            onBlur={onBlur}
            isChanged={designCellOverridden("H94", designInputOverrides)}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="uppercase tracking-wide text-slate-500">MPH</span>
          <DebouncedYellowCell
            value={mphValue}
            onChange={(value) => onChange("design", "I93", value)}
            onBlur={onBlur}
            isChanged={designCellOverridden("I93", designInputOverrides)}
          />
        </label>
      </div>
      <table className={estimateWorkbookTableDivide}>
        <thead className={estimateWorkbookTableHead}>
          <tr>
            <th className="px-3 py-2">Qty / Driver</th>
            <th className="px-3 py-2">Item</th>
            <th className="px-3 py-2">Rate / Setting</th>
            <th className="px-3 py-2 text-right">Cost</th>
          </tr>
        </thead>
        <tbody className={estimateWorkbookTableBody}>
          {rows.map((row) => {
            const rowNumber = Number(row.rowKey.replace("row-", ""));
            const rateEditable = rowNumber === 95 || rowNumber === 96;
            return (
              <tr key={row.rowKey}>
                <td className="px-3 py-2">
                  {row.quantityCell ? (
                    <DebouncedYellowCell
                      value={row.quantity}
                      onChange={(value) => onChange("design", row.quantityCell!, value)}
                      onBlur={onBlur}
                      isChanged={designCellOverridden(row.quantityCell, designInputOverrides)}
                    />
                  ) : (
                    <GreenCell value={row.hours} cell={row.hoursCell} />
                  )}
                </td>
                <td className="px-3 py-2 font-semibold text-slate-900 dark:text-white">{row.label}</td>
                <td className="px-3 py-2">
                  {rateEditable && row.rateCell ? (
                    <DebouncedYellowCell
                      value={row.rate}
                      onChange={(value) => onChange("design", row.rateCell!, value)}
                      onBlur={onBlur}
                      isChanged={designCellOverridden(row.rateCell, designInputOverrides)}
                    />
                  ) : (
                    <GreenCell value={row.rate} cell={row.rateCell} />
                  )}
                </td>
                <td className="px-3 py-2 text-right font-semibold text-slate-900 dark:text-white">
                  <div className="flex justify-end">
                    <GreenCell value={row.cost} cell={row.costCell} currency />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function YellowCell({
  value,
  onChange,
  onBlur,
}: {
  value: number | string | null | undefined;
  onChange: (value: number | null) => void;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
}) {
  const { canEditWorkbook } = useEstimateEditorPermissions();
  const [draftValue, setDraftValue] = useState(value == null ? "" : String(value));
  const [isFocused, setIsFocused] = useState(false);
  const latestValueRef = useRef(draftValue);
  const focusedRef = useRef(false);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    latestValueRef.current = draftValue;
    focusedRef.current = isFocused;
    onChangeRef.current = onChange;
  }, [draftValue, isFocused, onChange]);

  useEffect(() => {
    if (!isFocused) {
      setDraftValue(value == null ? "" : String(value));
    }
  }, [isFocused, value]);

  useEffect(() => {
    return () => {
      if (focusedRef.current) {
        commitValue(latestValueRef.current);
      }
    };
  }, []);

  const commitValue = (nextValue: string) => {
    if (!canEditWorkbook) return;
    const trimmed = nextValue.trim();
    if (trimmed === "") {
      onChangeRef.current(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;
    onChangeRef.current(parsed);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draftValue}
      onFocus={() => setIsFocused(true)}
      onChange={(event) => {
        if (!canEditWorkbook) return;
        setDraftValue(event.target.value);
      }}
      onBlur={(event) => {
        setIsFocused(false);
        commitValue(event.target.value);
        onBlur?.(event);
      }}
      disabled={!canEditWorkbook}
      readOnly={!canEditWorkbook}
      className={`${estimateYellowInputStatic} disabled:cursor-not-allowed disabled:opacity-60`}
    />
  );
}

function DebouncedYellowCell({
  value,
  onChange,
  onBlur,
  isChanged = true,
  defaultValue,
}: {
  value: number | string | null | undefined;
  onChange: (value: number | null) => void;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
  isChanged?: boolean;
  defaultValue?: number | null;
}) {
  const { canEditWorkbook } = useEstimateEditorPermissions();
  const [draftValue, setDraftValue] = useState(value == null ? "" : String(value));
  const [isFocused, setIsFocused] = useState(false);
  const latestValueRef = useRef(draftValue);
  const focusedRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const isVisiblyChanged =
    defaultValue === undefined
      ? isChanged
      : !valuesMatchDefault(draftValue.trim() === "" ? null : draftValue, defaultValue);

  useEffect(() => {
    latestValueRef.current = draftValue;
    focusedRef.current = isFocused;
    onChangeRef.current = onChange;
  }, [draftValue, isFocused, onChange]);

  useEffect(() => {
    if (!isFocused) {
      setDraftValue(value == null ? "" : String(value));
    }
  }, [isFocused, value]);

  useEffect(() => {
    return () => {
      if (focusedRef.current) {
        commitValue(latestValueRef.current);
      }
    };
  }, []);

  const commitValue = (nextValue: string) => {
    if (!canEditWorkbook) return;
    const trimmed = nextValue.trim();
    if (trimmed === "") {
      onChangeRef.current(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;
    onChangeRef.current(parsed);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draftValue}
      onFocus={() => setIsFocused(true)}
      onChange={(event) => {
        if (!canEditWorkbook) return;
        const nextValue = event.target.value;
        setDraftValue(nextValue);
      }}
      onBlur={(event) => {
        setIsFocused(false);
        commitValue(event.target.value);
        onBlur?.(event);
      }}
      disabled={!canEditWorkbook}
      readOnly={!canEditWorkbook}
      className={`w-28 rounded-lg border px-2 py-1.5 text-sm font-semibold outline-none transition disabled:cursor-not-allowed disabled:opacity-60 ${
        isVisiblyChanged ? estimateYellowInputChanged : estimateYellowInputDefault
      }`}
    />
  );
}

function GreenCell({
  value,
  cell,
  currency = false,
  sheetOnlyHighlight = false,
  precision = 2,
}: {
  value: number | null | undefined;
  cell?: string | null;
  currency?: boolean;
  sheetOnlyHighlight?: boolean;
  precision?: number;
}) {
  const normalizedCell = cell ? normalizeCellAddress(cell) : null;
  return (
    <span
      title={normalizedCell ? `Locked ${normalizedCell}` : "Locked calculated value"}
      className={sheetOnlyHighlight ? estimateGreenCellSheet : estimateGreenCell}
    >
      {value === null || value === undefined
        ? "-"
        : currency
          ? formatExactCurrency(Number(value))
          : Number(value).toLocaleString(undefined, { maximumFractionDigits: precision })}
    </span>
  );
}

function WorkbookCostSection({
  title,
  description,
  section,
  rows,
  summary,
  onChange,
  onBlur,
}: {
  title: string;
  description: string;
  section: "field" | "shop" | "design";
  rows: EstimateWorkbookSectionRow[];
  summary: Array<{ label: string; value: number | null; kind: "number" | "currency" }>;
  onChange: (
    section: "field" | "shop" | "design" | "subsAndFees",
    cell: string,
    value: number | string | null,
  ) => void;
  onBlur: (event: FocusEvent<HTMLInputElement>) => void;
}) {
  const editableRows = rows.filter((row) => row.quantityCell || row.rateCell);
  return (
    <EstimateSectionCard
      title={title}
      description={description}
      rightSlot={
        <div className="flex flex-wrap gap-2">
          {summary.map((item) => (
            <div
              key={item.label}
              className={estimateWorkbookStat}
            >
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                {item.label}
              </div>
              <div className="font-semibold text-slate-900 dark:text-white">
                {item.kind === "currency" ? formatExactCurrency(item.value) : item.value ?? "-"}
              </div>
            </div>
          ))}
        </div>
      }
    >
      <div className={estimateWorkbookPanel}>
        <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700/70">
          <thead className={estimateWorkbookTableHead}>
            <tr>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2">Input</th>
              <th className="px-3 py-2">Rate</th>
              <th className="px-3 py-2">Hours</th>
              <th className="px-3 py-2">Days</th>
              <th className="px-3 py-2 text-right">Cost</th>
            </tr>
          </thead>
          <tbody className={estimateWorkbookTableBody}>
            {editableRows.map((row) => (
              <tr key={`${section}-${row.rowKey}`}>
                <td className="px-3 py-2 font-semibold text-slate-900 dark:text-white">{row.label}</td>
                <td className="px-3 py-2">
                  {row.quantityCell ? (
                    <WorkbookNumberInput
                      value={row.quantity}
                      onChange={(value) => onChange(section, row.quantityCell!, value)}
                      onBlur={onBlur}
                    />
                  ) : (
                    <LockedValue value={null} />
                  )}
                </td>
                <td className="px-3 py-2">
                  {row.rateCell ? (
                    <WorkbookNumberInput
                      value={row.rate}
                      onChange={(value) => onChange(section, row.rateCell!, value)}
                      onBlur={onBlur}
                    />
                  ) : (
                    <LockedValue value={null} />
                  )}
                </td>
                <td className="px-3 py-2"><LockedValue value={row.hours} /></td>
                <td className="px-3 py-2"><LockedValue value={row.days} /></td>
                <td className="px-3 py-2 text-right font-semibold text-slate-900 dark:text-white">
                  {formatExactCurrency(row.cost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700/60 dark:bg-slate-950/30 dark:text-slate-400">
        Calculated cells are locked. Use the input and rate cells for estimate-specific adjustments.
      </div>
    </EstimateSectionCard>
  );
}

function WorkbookNumberInput({
  value,
  onChange,
  onBlur,
}: {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  onBlur: (event: FocusEvent<HTMLInputElement>) => void;
}) {
  const { canEditWorkbook } = useEstimateEditorPermissions();
  const [draftValue, setDraftValue] = useState(value == null ? "" : String(value));
  const [isFocused, setIsFocused] = useState(false);
  const latestValueRef = useRef(draftValue);
  const focusedRef = useRef(false);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    latestValueRef.current = draftValue;
    focusedRef.current = isFocused;
    onChangeRef.current = onChange;
  }, [draftValue, isFocused, onChange]);

  useEffect(() => {
    if (!isFocused) {
      setDraftValue(value == null ? "" : String(value));
    }
  }, [isFocused, value]);

  useEffect(() => {
    return () => {
      if (focusedRef.current) {
        commitValue(latestValueRef.current);
      }
    };
  }, []);

  const commitValue = (nextValue: string) => {
    if (!canEditWorkbook) return;
    const trimmed = nextValue.trim();
    if (trimmed === "") {
      onChangeRef.current(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;
    onChangeRef.current(parsed);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draftValue}
      onFocus={() => setIsFocused(true)}
      onChange={(event) => {
        if (!canEditWorkbook) return;
        setDraftValue(event.target.value);
      }}
      onBlur={(event) => {
        setIsFocused(false);
        commitValue(event.target.value);
        onBlur(event);
      }}
      disabled={!canEditWorkbook}
      readOnly={!canEditWorkbook}
      className={`${estimateWorkbookNumberInput} disabled:cursor-not-allowed disabled:opacity-60`}
    />
  );
}

function LockedValue({ value }: { value: number | null | undefined }) {
  return (
    <span className={estimateLockedValue}>
      {value === null || value === undefined ? "-" : Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}
    </span>
  );
}

function SubsMiscSection({
  draft,
  summary,
  onValueChange,
  onLabelChange,
  onBlur,
}: {
  draft: EstimateDraft;
  summary: EstimateSummaryNumbers;
  onValueChange: (
    section: "field" | "shop" | "design" | "subsAndFees",
    cell: string,
    value: number | string | null,
  ) => void;
  onLabelChange: (cell: string, value: string) => void;
  onBlur: (event: FocusEvent<HTMLInputElement>) => void;
}) {
  const { canEditWorkbook } = useEstimateEditorPermissions();
  const fixedCells = Object.keys(SUBS_MISC_FIXED_LABELS);
  const customCells = [...SUBS_MISC_CUSTOM_CELLS];
  const cells = [...fixedCells, ...customCells];
  const labels = draft.subsAndFees.miscellaneousLabels ?? {};
  return (
    <EstimateSectionCard
      title="Subs & Miscellaneous"
      description="Fixed workbook rows, custom rows, markup, fees, PE stamp, and bond inputs."
      rightSlot={
        <div className={estimateWorkbookStat}>
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Subs Total</div>
          <div className="font-semibold text-slate-900 dark:text-white">{formatExactCurrency(summary.subsTotal)}</div>
        </div>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <div className={estimateWorkbookPanel}>
          <table className={estimateWorkbookTableDivide}>
            <thead className={estimateWorkbookTableHead}>
              <tr>
                <th className="px-3 py-2">Row</th>
                <th className="px-3 py-2">Label</th>
                <th className="px-3 py-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody className={estimateWorkbookTableBody}>
              {cells.map((cell) => {
                const isCustom = customCells.includes(cell as (typeof SUBS_MISC_CUSTOM_CELLS)[number]);
                return (
                  <tr key={cell}>
                    <td className="px-3 py-2 text-xs font-semibold text-slate-500">{cell}</td>
                    <td className="px-3 py-2">
                      {isCustom ? (
                        <input
                          value={labels[cell] ?? ""}
                          onChange={(event) => onLabelChange(cell, event.target.value)}
                          onBlur={onBlur}
                          placeholder="Custom row label"
                          disabled={!canEditWorkbook}
                          readOnly={!canEditWorkbook}
                          className={`w-full ${estimateInputFieldCompactSm} disabled:cursor-not-allowed disabled:opacity-60`}
                        />
                      ) : (
                        <span className="font-semibold text-slate-900 dark:text-white">{SUBS_MISC_FIXED_LABELS[cell]}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <WorkbookNumberInput
                        value={Number(draft.subsAndFees.miscellaneousCosts[cell] ?? 0)}
                        onChange={(value) => onValueChange("subsAndFees", cell, value)}
                        onBlur={onBlur}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="space-y-3">
          <PricingMiniInput label="Subs Markup %" value={draft.inputs.subsMarkupPercent} onChange={(value) => onValueChange("subsAndFees", "subsMarkupPercent", value)} onBlur={onBlur} />
          <div className={estimatePricingLabel}>
            Fees
            <div className={estimatePricingReadonlyAccent}>
              {formatExactCurrency(summary.fees)}
            </div>
          </div>
          <PricingMiniInput label="PE Stamp" value={draft.inputs.peStamp ?? 0} onChange={(value) => onValueChange("subsAndFees", "peStamp", value)} onBlur={onBlur} />
          <PricingMiniInput label="Bond" value={draft.inputs.bondCost ?? 0} onChange={(value) => onValueChange("subsAndFees", "bondCost", value)} onBlur={onBlur} />
          <div className={estimateTotalsPanel}>
            <div className="flex justify-between"><span>Subtotal</span><b className="text-slate-900 dark:text-white">{formatExactCurrency(summary.subsSubtotal)}</b></div>
            <div className="mt-2 flex justify-between"><span>Markup</span><b className="text-slate-900 dark:text-white">{formatExactCurrency(summary.subsMarkupCost)}</b></div>
            <div className="mt-2 flex justify-between"><span>Fees / PE / Bond</span><b className="text-slate-900 dark:text-white">{formatExactCurrency(summary.feesTotal)}</b></div>
          </div>
        </div>
      </div>
    </EstimateSectionCard>
  );
}

function PricingMiniInput({
  label,
  value,
  onChange,
  onBlur,
}: {
  label: string;
  value: number;
  onChange: (value: number | null) => void;
  onBlur: (event: FocusEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className={estimatePricingLabel}>
      {label}
      <WorkbookNumberInput value={value} onChange={onChange} onBlur={onBlur} />
    </label>
  );
}

function ModalHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className={estimateModalTitle}>{title}</h2>
      <p className={estimateModalDescription}>{description}</p>
    </div>
  );
}

function ModalFooter({
  onClose,
  actionLabel,
  onAction,
}: {
  onClose: () => void;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="mt-6 flex justify-end gap-2">
      <button
        type="button"
        onClick={onClose}
        className={estimateModalCancelBtn}
      >
        Cancel
      </button>
      {onAction ? (
        <button
          type="button"
          onClick={onAction}
          className={`${estimatePrimaryButton} !text-white`}
        >
          {actionLabel || "Save"}
        </button>
      ) : null}
    </div>
  );
}

type CatalogPriceFilter = "all" | "editable" | "calculated";

function MaterialCatalogModal({
  rows,
  selectedLines,
  onAdd,
  onClose,
}: {
  rows: EstimateCatalogRow[];
  selectedLines: EstimateVisibleMaterialLine[];
  onAdd: (part: PartSearchResult, quantity: number, manualUnitCost: number | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [subcategoryFilter, setSubcategoryFilter] = useState("all");
  const [priceFilter, setPriceFilter] = useState<CatalogPriceFilter>("all");
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [manualCosts, setManualCosts] = useState<Record<string, string>>({});

  const selectedRowKeys = useMemo(
    () =>
      new Set(
        selectedLines
          .map((line) => line.catalogRowKey)
          .filter((rowKey): rowKey is string => Boolean(rowKey)),
      ),
    [selectedLines],
  );

  const addableRows = useMemo(
    () => rows.filter((row) => row.rowType !== "section_header" && row.quantityCell),
    [rows],
  );

  const sectionOptions = useMemo(
    () => Array.from(new Set(addableRows.map((row) => row.section).filter(Boolean))).sort(),
    [addableRows],
  );

  const subcategoryOptions = useMemo(() => {
    const sourceRows =
      sectionFilter === "all"
        ? addableRows
        : addableRows.filter((row) => row.section === sectionFilter);
    return Array.from(
      new Set(sourceRows.map((row) => row.subcategory).filter((value): value is string => Boolean(value))),
    ).sort();
  }, [addableRows, sectionFilter]);

  useEffect(() => {
    if (
      subcategoryFilter !== "all" &&
      !subcategoryOptions.includes(subcategoryFilter)
    ) {
      setSubcategoryFilter("all");
    }
  }, [subcategoryFilter, subcategoryOptions]);

  const filteredRows = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return addableRows.filter((row) => {
      if (sectionFilter !== "all" && row.section !== sectionFilter) return false;
      if (subcategoryFilter !== "all" && row.subcategory !== subcategoryFilter) return false;
      if (priceFilter === "editable" && row.formulaKey) return false;
      if (priceFilter === "calculated" && !row.formulaKey) return false;
      if (showSelectedOnly && !selectedRowKeys.has(row.rowKey)) return false;
      if (terms.length === 0) return true;
      const haystack = [
        row.sheetRow,
        row.label,
        row.description,
        row.detail,
        row.section,
        row.subcategory,
        row.quantityCell,
        row.unitCostCell,
        row.defaultUnitCost,
        row.unitCost,
      ]
        .filter((value) => value !== null && value !== undefined)
        .join(" ")
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [
    addableRows,
    priceFilter,
    query,
    sectionFilter,
    selectedRowKeys,
    showSelectedOnly,
    subcategoryFilter,
  ]);

  const groupedRows = useMemo(() => {
    const groups = new Map<string, EstimateCatalogRow[]>();
    filteredRows.forEach((row) => {
      const key = `${row.section || "Materials"}|||${row.subcategory || "General"}`;
      const current = groups.get(key) ?? [];
      current.push(row);
      groups.set(key, current);
    });
    return Array.from(groups.entries()).map(([key, groupRows]) => {
      const [section, subcategory] = key.split("|||");
      return { section, subcategory, rows: groupRows };
    });
  }, [filteredRows]);

  const addRow = (row: EstimateCatalogRow) => {
    const quantity = Math.max(0, quantities[row.rowKey] ?? 1);
    onAdd(catalogRowToSearchResult(row), quantity, numberOrNull(manualCosts[row.rowKey] ?? ""));
  };

  return (
    <div
      className={estimateModalOverlay}
      onMouseDown={onClose}
    >
      <div
        className={estimateCatalogModalPanel}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={estimateCatalogModalHeader}>
          <div>
            <h2 className={estimateModalTitle}>Material Catalog</h2>
            <p className={estimateModalDescription}>
              Browse System 1 catalog parts by section, price, workbook cell, and selected status.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={estimateModalCloseBtn}
          >
            Done
          </button>
        </div>

        <div className={estimateCatalogModalToolbar}>
          <input
            autoFocus
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search part, description, row, section, price, or cell..."
            className={estimateInputFieldCompact}
          />
          <select
            value={sectionFilter}
            onChange={(event) => setSectionFilter(event.target.value)}
            className={estimateInputFieldCompact}
          >
            <option value="all">All sections</option>
            {sectionOptions.map((section) => (
              <option key={section} value={section}>
                {section}
              </option>
            ))}
          </select>
          <select
            value={subcategoryFilter}
            onChange={(event) => setSubcategoryFilter(event.target.value)}
            className={estimateInputFieldCompact}
          >
            <option value="all">All subcategories</option>
            {subcategoryOptions.map((subcategory) => (
              <option key={subcategory} value={subcategory}>
                {subcategory}
              </option>
            ))}
          </select>
          <select
            value={priceFilter}
            onChange={(event) => setPriceFilter(event.target.value as CatalogPriceFilter)}
            className={estimateInputFieldCompact}
          >
            <option value="all">All price types</option>
            <option value="editable">Editable prices</option>
            <option value="calculated">Calculated prices</option>
          </select>
          <label className={estimateCatalogModalFilterLabel}>
            <input
              type="checkbox"
              checked={showSelectedOnly}
              onChange={(event) => setShowSelectedOnly(event.target.checked)}
              className="h-4 w-4"
            />
            Selected
          </label>
        </div>

        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800">
          <span>{filteredRows.length.toLocaleString()} parts</span>
          <span>{selectedRowKeys.size.toLocaleString()} selected rows</span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {groupedRows.length === 0 ? (
            <div className="flex min-h-80 items-center justify-center p-6 text-center text-sm text-slate-500">
              No catalog parts match the current filters.
            </div>
          ) : (
            groupedRows.map((group) => (
              <div key={`${group.section}-${group.subcategory}`}>
                <div className={estimateCatalogGroupHeader}>
                  <div className={estimateCatalogGroupTitle}>{group.section}</div>
                  <div className="text-xs text-slate-500">{group.subcategory}</div>
                </div>
                <table className={`min-w-[78rem] w-full ${estimateWorkbookTableDivide}`}>
                  <thead className={estimateWorkbookTableHead}>
                    <tr>
                      <th className="px-3 py-2">Part / Description</th>
                      <th className="px-3 py-2">Section</th>
                      <th className="px-3 py-2">Unit Price</th>
                      <th className="px-3 py-2">Quantity Cell</th>
                      <th className="px-3 py-2">Price Type</th>
                      <th className="px-3 py-2">Quantity</th>
                      <th className="px-3 py-2">Manual Cost</th>
                      <th className="px-3 py-2 text-right">Add</th>
                    </tr>
                  </thead>
                  <tbody className={estimateTableBody}>
                    {group.rows.map((row) => {
                      const isSelected = selectedRowKeys.has(row.rowKey);
                      const isFormula = Boolean(row.formulaKey);
                      return (
                        <tr
                          key={row.rowKey}
                          className={isSelected ? "bg-blue-500/10" : ""}
                        >
                          <td className="px-3 py-3 align-top">
                            <div className="font-semibold text-slate-900 dark:text-white">
                              {[row.label, row.description].filter(Boolean).join(" ") || `Row ${row.sheetRow}`}
                            </div>
                            <div className="mt-1 max-w-xl text-xs text-slate-400">
                              {row.detail || row.description || "-"}
                            </div>
                            <div className="mt-1 text-[11px] font-semibold text-slate-600">
                              Row {row.sheetRow}
                            </div>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">{row.section}</div>
                            <div className="mt-1 text-xs text-slate-500">{row.subcategory || "General"}</div>
                          </td>
                          <td className="px-3 py-3 align-top font-semibold text-emerald-700 dark:text-emerald-300">
                            {formatExactCurrency(row.unitCost ?? row.defaultUnitCost)}
                          </td>
                          <td className="px-3 py-3 align-top">
                            <div className="font-mono text-xs text-slate-600 dark:text-slate-300">{row.quantityCell || "-"}</div>
                            <div className="mt-1 font-mono text-[11px] text-slate-500 dark:text-slate-600">{row.unitCostCell || "-"}</div>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <span
                              className={isFormula ? estimateCatalogBadgeFormula : estimateCatalogBadgeEditable}
                            >
                              {isFormula ? "Calculated" : "Editable"}
                            </span>
                            {isSelected ? (
                              <div className="mt-2 text-xs font-semibold text-blue-700 dark:text-blue-300">Selected</div>
                            ) : null}
                          </td>
                          <td className="px-3 py-3 align-top">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={quantities[row.rowKey] ?? 1}
                              onChange={(event) =>
                                setQuantities((current) => ({
                                  ...current,
                                  [row.rowKey]: Number(event.target.value) || 0,
                                }))
                              }
                              className={`w-24 ${estimateInputFieldCompactSm}`}
                            />
                          </td>
                          <td className="px-3 py-3 align-top">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={manualCosts[row.rowKey] ?? ""}
                              disabled={isFormula}
                              onChange={(event) =>
                                setManualCosts((current) => ({
                                  ...current,
                                  [row.rowKey]: event.target.value,
                                }))
                              }
                              placeholder={isFormula ? "Formula" : "Optional"}
                              className={`w-28 ${estimateInputFieldCompactSm} disabled:cursor-not-allowed disabled:opacity-60`}
                            />
                          </td>
                          <td className="px-3 py-3 align-top text-right">
                            <button
                              type="button"
                              onClick={() => addRow(row)}
                              className={`${estimatePrimaryButton} !text-white px-3 py-2`}
                            >
                              Add
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function InventoryResults({
  results,
  isSearching,
  onPick,
}: {
  results: PartSearchResult[];
  isSearching: boolean;
  onPick: (part: PartSearchResult) => void;
}) {
  return (
    <div className={estimateInventoryResultsPanel}>
      {isSearching ? (
        <div className="flex items-center gap-2 p-4 text-sm text-slate-400">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-500 border-t-transparent" />
          Searching catalog...
        </div>
      ) : results.length === 0 ? (
        <div className="flex h-full min-h-[8rem] items-center justify-center p-4 text-center text-sm text-slate-500">
          Type at least 2 characters to search the System 1 catalog.
        </div>
      ) : (
        results.map((part) => (
          <button
            key={part.rowKey}
            type="button"
            onClick={() => onPick(part)}
            className="flex w-full items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 text-left text-sm transition last:border-0 hover:bg-slate-100 dark:border-slate-800 dark:hover:bg-slate-800/70"
          >
            <span className="min-w-0">
              <span className="block font-semibold text-slate-900 dark:text-white">{part.partNumber}</span>
              <span className="block truncate text-slate-500 dark:text-slate-400">{part.description || "-"}</span>
              <span className="block text-[11px] text-slate-500">
                Row {part.sheetRow} · {part.section}
                {part.subcategory ? ` / ${part.subcategory}` : ""}
              </span>
            </span>
            <span className="shrink-0 text-right text-xs text-slate-500 dark:text-slate-400">
              <span className="block text-slate-600 dark:text-slate-300">
                {part.isFormula ? "Calculated" : "Editable"}
              </span>
              <span className="block font-semibold text-emerald-700 dark:text-emerald-300">
                {formatExactCurrency(part.cost)}
              </span>
            </span>
          </button>
        ))
      )}
    </div>
  );
}

function InventoryPickerModal({
  title,
  description,
  quantity,
  manualCost,
  query,
  results,
  isSearching,
  onQuantityChange,
  onManualCostChange,
  onQueryChange,
  onPick,
  onClose,
}: {
  title: string;
  description: string;
  quantity: number;
  manualCost: string;
  query: string;
  results: PartSearchResult[];
  isSearching: boolean;
  onQuantityChange: (value: number) => void;
  onManualCostChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onPick: (part: PartSearchResult) => void;
  onClose: () => void;
}) {
  return (
    <div>
      <ModalHeader title={title} description={description} />

      <div className="mt-5">
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M9 3.5a5.5 5.5 0 1 0 3.42 9.83l3.13 3.12a.75.75 0 1 0 1.06-1.06l-3.13-3.12A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z"
              clipRule="evenodd"
            />
          </svg>
          <input
            autoFocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search catalog by row, part name, description, or category..."
            className="w-full rounded-lg border border-slate-600 bg-slate-800 py-2.5 pl-9 pr-3 text-sm text-white outline-none focus:border-blue-400"
          />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Quantity
            <input
              type="number"
              min="0"
              step="1"
              value={quantity}
              onChange={(event) => onQuantityChange(Number(event.target.value) || 0)}
              className={estimateInputFieldCompact}
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Manual Unit Cost
            <input
              type="number"
              min="0"
              step="0.01"
              value={manualCost}
              onChange={(event) => onManualCostChange(event.target.value)}
              placeholder="Optional — overrides catalog price"
              className={estimateInputFieldCompact}
            />
          </label>
        </div>
      </div>

      <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Results
      </div>
      <InventoryResults results={results} isSearching={isSearching} onPick={onPick} />

      <ModalFooter onClose={onClose} />
    </div>
  );
}

function CustomPartModal({
  form,
  vendors,
  onChange,
  onSubmit,
  onClose,
}: {
  form: MaterialForm;
  vendors: string[];
  onChange: (form: MaterialForm) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <div>
      <ModalHeader
        title="Custom Part"
        description="Create a manually priced part."
      />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold text-slate-400">
          Part / Name
          <input
            value={form.partNumber}
            onChange={(event) => onChange({ ...form, partNumber: event.target.value })}
            className={estimateInputFieldCompact}
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-400">
          Vendor
          <VendorSelect
            value={form.vendor}
            vendors={vendors}
            onChange={(vendor) => onChange({ ...form, vendor })}
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-400 sm:col-span-2">
          Description
          <textarea
            value={form.description}
            onChange={(event) => onChange({ ...form, description: event.target.value })}
            rows={2}
            className={estimateInputFieldCompact}
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-400">
          Quantity
          <input
            type="number"
            min="0"
            step="1"
            value={form.quantity}
            onChange={(event) =>
              onChange({ ...form, quantity: Number(event.target.value) || 0 })
            }
            className={estimateInputFieldCompact}
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-400">
          Manual Unit Cost
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.unitCost}
            onChange={(event) => onChange({ ...form, unitCost: event.target.value })}
            className={estimateInputFieldCompact}
          />
        </label>
      </div>

      <ModalFooter onClose={onClose} actionLabel="Add Custom Part" onAction={onSubmit} />
    </div>
  );
}


function EditMaterialModal({
  line,
  form,
  vendors,
  onChange,
  onSubmit,
  onClose,
}: {
  line: EstimateVisibleMaterialLine;
  form: MaterialForm;
  vendors: string[];
  onChange: (form: MaterialForm) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <div>
      <ModalHeader
        title="Edit Part"
        description={
          line.priceSource === "manual"
            ? "Custom Part — manual unit cost wins."
            : "Catalog Part — leave manual cost blank to use the catalog price."
        }
      />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold text-slate-400">
          Part / Name
          <input
            value={form.partNumber}
            onChange={(event) => onChange({ ...form, partNumber: event.target.value })}
            className={estimateInputFieldCompact}
          />
        </label>
        {line.catalogRowKey ? (
          <label className="grid gap-1 text-xs font-semibold text-slate-400">
            Section
            <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-300">
              {form.vendor || "—"}
            </div>
          </label>
        ) : (
          <label className="grid gap-1 text-xs font-semibold text-slate-400">
            Vendor
            <VendorSelect
              value={form.vendor}
              vendors={vendors}
              onChange={(vendor) => onChange({ ...form, vendor })}
            />
          </label>
        )}
        <label className="grid gap-1 text-xs font-semibold text-slate-400 sm:col-span-2">
          Description
          <textarea
            value={form.description}
            onChange={(event) => onChange({ ...form, description: event.target.value })}
            rows={2}
            className={estimateInputFieldCompact}
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-400">
          Manual Quantity
          <input
            type="number"
            min="0"
            step="1"
            value={form.quantity}
            onChange={(event) =>
              onChange({ ...form, quantity: Number(event.target.value) || 0 })
            }
            className={estimateInputFieldCompact}
          />
          {line.autoQty > 0 ? (
            <span className="text-[11px] font-normal text-emerald-300">
              + {line.autoQty} from related parts (auto)
            </span>
          ) : null}
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-400">
          Manual Unit Cost
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.unitCost}
            onChange={(event) => onChange({ ...form, unitCost: event.target.value })}
            placeholder={
              line.isCatalogFormula
                ? "Optional — overrides catalog formula"
                : line.databaseUnitPrice !== null
                  ? `Catalog: ${formatExactCurrency(line.databaseUnitPrice)}`
                  : "Required"
            }
            className={estimateInputFieldCompact}
          />
        </label>
      </div>
      <ModalFooter onClose={onClose} actionLabel="Save Changes" onAction={onSubmit} />
    </div>
  );
}

function VendorAdjustmentsSection({
  rules,
  saveState,
  onAdd,
  onChange,
  onRemove,
  onBlur,
}: {
  rules: EstimateVendorAdjustmentRule[];
  saveState: SaveState;
  onAdd: () => void;
  onChange: (id: string, patch: Partial<EstimateVendorAdjustmentRule>) => void;
  onRemove: (id: string) => void;
  onBlur: (event: FocusEvent<HTMLInputElement>) => void;
}) {
  return (
    <EstimateSectionCard
      title="Vendor Adjustments"
      description="Apply estimate-only percentage changes to inventory-priced lines by vendor name."
      rightSlot={
        <div className="rounded-full border border-slate-600 bg-slate-900/50 px-3 py-1 text-xs font-semibold text-slate-300">
          {saveStateLabel(saveState)}
        </div>
      }
    >
      <div className="space-y-2">
        {rules.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-600 p-4 text-sm text-slate-400">
            No vendor rules yet. Manual unit prices always override these rules.
          </div>
        ) : (
          rules.map((rule) => (
            <div
              key={rule.id}
              className="grid gap-2 rounded-xl border border-slate-700/50 bg-slate-900/30 p-3 sm:grid-cols-[1fr_10rem_auto]"
            >
              <input
                value={rule.vendor}
                onChange={(event) => onChange(rule.id, { vendor: event.target.value })}
                onBlur={onBlur}
                placeholder="Vendor name, for example ETNA"
                className={estimateInputFieldCompact}
              />
              <input
                type="number"
                step="0.01"
                value={rule.percent}
                onChange={(event) => onChange(rule.id, { percent: Number(event.target.value) || 0 })}
                onBlur={onBlur}
                placeholder="Percent"
                className={estimateInputFieldCompact}
              />
              <button
                type="button"
                onClick={() => onRemove(rule.id)}
                className="rounded-lg border border-red-400/40 px-3 py-2 text-sm font-semibold text-red-200 hover:bg-red-500/10"
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="mt-3 rounded-lg border border-blue-400/50 bg-blue-500/10 px-3 py-2 text-sm font-semibold text-blue-200 transition hover:bg-blue-500/20"
      >
        Add Vendor Rule
      </button>
    </EstimateSectionCard>
  );
}

function PricingControlsSection({
  draft,
  summary,
  onChange,
  onBlur,
}: {
  draft: EstimateDraft;
  summary: EstimateSummaryNumbers;
  onChange: (
    field: keyof EstimateDraft["project"] | keyof EstimateDraft["inputs"],
    value: string | number | null,
  ) => void;
  onBlur: (event: FocusEvent<HTMLInputElement>) => void;
}) {
  const { canEditPricing, canEditWorkbook } = useEstimateEditorPermissions();
  const canEdit = canEditPricing || canEditWorkbook;
  type FieldSource = "inputs" | "project";
  type PricingField = {
    key: keyof EstimateDraft["inputs"] | keyof EstimateDraft["project"];
    label: string;
    step: string;
    source: FieldSource;
    helper?: string;
  };
  const percentageFields: PricingField[] = [
    { key: "salesTaxPercent", label: "Sales Tax", step: "1", source: "inputs" },
    { key: "materialInflationPercent", label: "Material Inflation", step: "1", source: "inputs" },
    { key: "overheadPercent", label: "Overhead", step: "1", source: "inputs" },
    { key: "profitPercent", label: "Profit", step: "1", source: "inputs" },
    { key: "subsMarkupPercent", label: "Subs Markup", step: "1", source: "inputs" },
  ];
  const jobFields: PricingField[] = [
    { key: "milesToJobSite", label: "Miles To Job", step: "0.01", source: "inputs", helper: "One-way miles" },
    { key: "squareFootage", label: "Square Footage", step: "1", source: "project" },
  ];
  const adderFields: PricingField[] = [
    { key: "peStamp", label: "PE Stamp", step: "0.01", source: "inputs" },
    { key: "bondCost", label: "Bond Cost", step: "0.01", source: "inputs" },
  ];

  const rawValueForField = (field: PricingField) => {
    const raw =
      field.source === "project"
        ? (draft.project as Record<string, unknown>)[field.key as string]
        : (draft.inputs as Record<string, unknown>)[field.key as string];
    return typeof raw === "number" ? raw : raw === null || raw === undefined ? "" : String(raw);
  };

  const renderPercentInput = (field: PricingField) => {
    const storedRaw = rawValueForField(field);
    const displayValue =
      typeof storedRaw === "number"
        ? draftPercentToDisplay(storedRaw)
        : storedRaw === ""
          ? ""
          : storedRaw;

    return (
      <label key={field.key} className={estimatePricingLabel}>
        <span className="min-w-0 leading-snug">{field.label}</span>
        <div className="relative min-w-0">
          <input
            type="number"
            min="0"
            step={field.step}
            value={displayValue}
            onChange={(event) =>
              onChange(
                field.key,
                event.target.value === "" ? null : Number(event.target.value),
              )
            }
            onBlur={(event) => {
              const raw = rawValueForField(field);
              if (typeof raw === "number") {
                const normalized = normalizeDraftPercent(raw);
                if (normalized !== null && normalized !== raw) {
                  onChange(field.key, normalized);
                }
              }
              onBlur(event);
            }}
            disabled={!canEdit}
            readOnly={!canEdit}
            className={`${estimatePricingInputWithSuffix} disabled:cursor-not-allowed disabled:opacity-60`}
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-medium text-slate-500 dark:text-slate-400">
            %
          </span>
        </div>
      </label>
    );
  };

  const renderInput = (field: PricingField) => (
    <label key={field.key} className={estimatePricingLabel}>
      <span className="min-w-0 leading-snug">{field.label}</span>
      <input
        type="number"
        min="0"
        step={field.step}
        value={rawValueForField(field) as number | string}
        onChange={(event) =>
          onChange(
            field.key,
            event.target.value === "" ? null : Number(event.target.value),
          )
        }
        onBlur={onBlur}
        disabled={!canEdit}
        readOnly={!canEdit}
        className={`${estimatePricingInput} disabled:cursor-not-allowed disabled:opacity-60`}
      />
      <span
        className={`min-h-5 min-w-0 text-xs font-medium leading-snug ${
          field.helper ? "text-slate-500" : "invisible"
        }`}
        aria-hidden={!field.helper}
      >
        {field.helper ?? "\u00a0"}
      </span>
    </label>
  );

  const renderReadonly = (label: string, value: number | null | undefined, accent = false) => (
    <div className={estimatePricingLabel}>
      <span className="min-w-0 leading-snug">{label}</span>
      <div
        className={accent ? estimatePricingReadonlyAccent : estimatePricingReadonly}
      >
        {value === null || value === undefined ? "-" : formatExactCurrency(value)}
      </div>
      <span className="min-h-5" aria-hidden="true" />
    </div>
  );

  const sectionClass = estimatePricingSection;
  const sectionTitleClass = estimatePricingSectionTitle;
  const sectionDescriptionClass = "mt-1 text-xs text-slate-500";

  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-2">
      <div className={`${sectionClass} min-w-0 overflow-hidden`}>
        <div className="mb-4">
          <h3 className={sectionTitleClass}>Percentages</h3>
        </div>
        <div className={estimatePricingFieldGrid}>
          {percentageFields.map(renderPercentInput)}
        </div>
      </div>

      <div className={`${sectionClass} min-w-0 overflow-hidden`}>
        <div className="mb-4">
          <h3 className={sectionTitleClass}>Job Inputs</h3>
          <p className={sectionDescriptionClass}>Project values used by the estimate summary and cost-per-foot metrics.</p>
        </div>
        <div className={estimatePricingFieldGrid}>
          {jobFields.map(renderInput)}
        </div>
      </div>

      <div className={`${sectionClass} min-w-0 overflow-hidden`}>
        <div className="mb-4">
          <h3 className={sectionTitleClass}>Fees & Adders</h3>
          <p className={sectionDescriptionClass}>Fees are calculated automatically from the workbook fee table.</p>
        </div>
        <div className={estimatePricingFieldGrid}>
          {renderReadonly("Calculated Fees", summary.fees, true)}
          {adderFields.map(renderInput)}
        </div>
      </div>

      <div className={`${sectionClass} min-w-0 overflow-hidden`}>
        <div className="mb-4">
          <h3 className={sectionTitleClass}>Calculated Totals</h3>
          <p className={sectionDescriptionClass}>Read-only totals update as pricing controls are changed.</p>
        </div>
        <div className={estimatePricingFieldGrid}>
          {renderReadonly("Fees / PE / Bond", summary.feesTotal, true)}
          {renderReadonly("Subtotal", summary.subtotal)}
          {renderReadonly("With Overhead", summary.subtotalWithOverhead)}
          {renderReadonly("Final Total", summary.totalCost, true)}
        </div>
      </div>
    </div>
  );
}
