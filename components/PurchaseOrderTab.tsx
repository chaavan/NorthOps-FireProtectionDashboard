'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { JobLineItem, JobMetadata, UpdateJobResponse } from '@/lib/types';
import { buildSalesTaxTotals } from '@/lib/stockBackPdfShared';
import PurchaseOrderPDFButton from './PurchaseOrderPDFButton';

interface PurchaseOrderTabProps {
  jobNumber: string;
  jobName: string;
  lineItems: JobLineItem[];
  listNumberContext?: string | null;
  onManualCostSaved?: (rowIndex: number, manualCost: number | null) => void;
  purchaseOrderAccountedFor?: boolean;
  onJobMetaUpdated?: (jobMeta: JobMetadata) => void;
  canEditUnitCost?: boolean;
}

interface LineItemWithCost extends JobLineItem {
  unitCost: number | null;
  lineTotal: number | null;
  supplier: string | null;
  databaseCost: number | null;
  source: 'vendor' | 'shop' | null;
  quantityForCost: number;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const PRICE_MATCH_TOLERANCE = 0.001;

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatCostInput(value: number | null): string {
  return value === null ? '' : value.toFixed(2);
}

function parseDraftCost(value: string): number | null | 'invalid' {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return 'invalid';

  return roundCurrency(parsed);
}

function formatCurrency(value: number | null): string {
  return value === null ? '—' : `$${value.toFixed(2)}`;
}

export default function PurchaseOrderTab({
  jobNumber,
  jobName,
  lineItems,
  listNumberContext = null,
  onManualCostSaved,
  purchaseOrderAccountedFor = false,
  onJobMetaUpdated,
  canEditUnitCost = false,
}: PurchaseOrderTabProps) {
  const [localPoAccounted, setLocalPoAccounted] = useState(purchaseOrderAccountedFor);
  const [poAccountedSaving, setPoAccountedSaving] = useState(false);

  useEffect(() => {
    setLocalPoAccounted(purchaseOrderAccountedFor);
  }, [purchaseOrderAccountedFor]);

  const [pricingData, setPricingData] = useState<Map<string, { cost: number; supplier: string }>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftCosts, setDraftCosts] = useState<Map<number, string>>(new Map());
  const [saveStates, setSaveStates] = useState<Map<number, SaveState>>(new Map());
  const [saveErrors, setSaveErrors] = useState<Map<number, string>>(new Map());
  const [editingRows, setEditingRows] = useState<Set<number>>(new Set());
  const requestTokensRef = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    const fetchPricingData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const partNumbers = lineItems
          .map((item) => item.partNumber)
          .filter((pn): pn is string => !!pn);

        if (partNumbers.length === 0) {
          setPricingData(new Map());
          setIsLoading(false);
          return;
        }

        const response = await fetch(
          `/api/parts/pricing?partNumbers=${encodeURIComponent(partNumbers.join(','))}`,
        );

        if (!response.ok) {
          throw new Error('Failed to fetch pricing data');
        }

        const data = await response.json();
        setPricingData(
          new Map<string, { cost: number; supplier: string }>(
            Object.entries(data.pricing),
          ),
        );
      } catch (err) {
        console.error('Error fetching pricing data:', err);
        setError((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPricingData();
  }, [lineItems]);

  useEffect(() => {
    setDraftCosts((prev) => {
      const next = new Map<number, string>();

      lineItems.forEach((item) => {
        const rowIndex = item.rowIndex;
        const state = saveStates.get(rowIndex);
        const isEditing = editingRows.has(rowIndex);

        if (state === 'saving' || state === 'error' || isEditing) {
          if (prev.has(rowIndex)) {
            next.set(rowIndex, prev.get(rowIndex) || '');
          }
          return;
        }

        const databaseCost = item.partNumber
          ? pricingData.get(item.partNumber)?.cost ?? null
          : null;
        const savedValue = item.manualCost ?? databaseCost;
        next.set(rowIndex, formatCostInput(savedValue));
      });

      return next;
    });
  }, [editingRows, lineItems, pricingData, saveStates]);

  const getDatabaseCost = (item: JobLineItem): number | null => {
    if (!item.partNumber) return null;
    return pricingData.get(item.partNumber)?.cost ?? null;
  };

  const getEffectiveManualOverride = (
    rowIndex: number,
    databaseCost: number | null,
    persistedManualCost: number | null | undefined,
  ): number | null => {
    const draftValue = draftCosts.get(rowIndex);
    if (draftValue !== undefined) {
      const parsed = parseDraftCost(draftValue);
      if (parsed === 'invalid') {
        return persistedManualCost ?? null;
      }
      if (parsed === null) {
        return null;
      }
      if (
        databaseCost !== null &&
        Math.abs(parsed - databaseCost) <= PRICE_MATCH_TOLERANCE
      ) {
        return null;
      }
      return parsed;
    }

    return persistedManualCost ?? null;
  };

  const getEffectiveUnitCost = (item: JobLineItem): { unitCost: number | null; databaseCost: number | null; effectiveManualCost: number | null } => {
    const databaseCost = getDatabaseCost(item);
    const effectiveManualCost = getEffectiveManualOverride(
      item.rowIndex,
      databaseCost,
      item.manualCost,
    );
    const unitCost = effectiveManualCost ?? databaseCost;

    return {
      unitCost,
      databaseCost,
      effectiveManualCost,
    };
  };

  const itemsWithCost = useMemo(() => {
    // PO tab quantity is only FAB + shop pull — not quantity needed, not vendor-ordered qty.
    return lineItems.map((item) => {
      const pricing = item.partNumber ? pricingData.get(item.partNumber) : null;
      const { unitCost, databaseCost } = getEffectiveUnitCost(item);

      const quantityFab = item.quantityFab || 0;
      const quantityPulled = item.quantityPulled || 0;
      const fabShopQty = quantityFab + quantityPulled;

      const lineTotal =
        unitCost !== null && fabShopQty > 0 ? unitCost * fabShopQty : null;

      return {
        ...item,
        unitCost,
        lineTotal,
        supplier:
          fabShopQty > 0
            ? 'Shop & FAB'
            : pricing?.supplier || item.type || null,
        databaseCost,
        source: fabShopQty > 0 ? 'shop' : 'vendor',
        quantityForCost: fabShopQty,
      } satisfies LineItemWithCost;
    });
  }, [draftCosts, lineItems, pricingData]);

  const itemsWithManualCosts = useMemo(() => {
    const seen = new Set<number>();

    return itemsWithCost
      .map((item): { partNumber: string; description: string; databaseCost: number; manualCost: number } | null => {
        if (seen.has(item.rowIndex)) return null;
        seen.add(item.rowIndex);

        const effectiveManualCost = getEffectiveManualOverride(
          item.rowIndex,
          item.databaseCost,
          item.manualCost,
        );
        const databaseCost = item.databaseCost;

        if (effectiveManualCost !== null && databaseCost !== null) {
          if (Math.abs(effectiveManualCost - databaseCost) > PRICE_MATCH_TOLERANCE) {
            return {
              partNumber: item.partNumber || 'Unknown',
              description: item.description || '—',
              databaseCost,
              manualCost: effectiveManualCost,
            };
          }
        }

        return null;
      })
      .filter((item): item is { partNumber: string; description: string; databaseCost: number; manualCost: number } => item !== null);
  }, [draftCosts, itemsWithCost]);

  const totals = useMemo(() => {
    const grandTotal = itemsWithCost.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0);

    const bySupplier = itemsWithCost.reduce((acc, item) => {
      const supplier = item.supplier || 'Unknown';
      if (!acc[supplier]) {
        acc[supplier] = {
          total: 0,
          items: 0,
          ordered: 0,
          received: 0,
          missingCostLines: 0,
          source: item.source || null,
        };
      }

      acc[supplier].items += 1;

      if (item.source === 'vendor') {
        // Vendor bucket: roll up projected ordering cost as unitCost × quantityNeeded
        // (lineTotal is null for vendor rows because fabShopQty is 0).
        const qtyNeeded = item.quantityNeeded || 0;
        if (item.unitCost !== null && qtyNeeded > 0) {
          acc[supplier].total += item.unitCost * qtyNeeded;
        } else if (qtyNeeded > 0 && item.unitCost === null) {
          acc[supplier].missingCostLines += 1;
        }

        const quantityReceived = item.quantityReceivedFromOrder || 0;
        const quantityOrdered = item.quantityOrdered || 0;
        acc[supplier].ordered += quantityOrdered;

        if (quantityReceived > 0) {
          const validReceived =
            quantityReceived > quantityOrdered ? quantityOrdered : quantityReceived;
          acc[supplier].received += validReceived;
        }
      } else {
        acc[supplier].total += item.lineTotal ?? 0;
      }

      return acc;
    }, {} as Record<string, {
      total: number;
      items: number;
      ordered: number;
      received: number;
      missingCostLines: number;
      source: 'vendor' | 'shop' | null;
    }>);

    return { grandTotal, bySupplier };
  }, [itemsWithCost]);

  const shopItemsOnly = useMemo(
    () => itemsWithCost.filter((item) => item.source === 'shop'),
    [itemsWithCost],
  );

  const shopTotals = useMemo(() => {
    const lineSubtotal = shopItemsOnly.reduce(
      (sum, item) => sum + (item.lineTotal ?? 0),
      0,
    );
    const taxTotals = buildSalesTaxTotals(lineSubtotal);
    const bySupplier = shopItemsOnly.reduce((acc, item) => {
      const supplier = item.supplier || 'Shop';
      if (!acc[supplier]) {
        acc[supplier] = { total: 0, items: 0 };
      }
      acc[supplier].total += item.lineTotal ?? 0;
      acc[supplier].items += 1;
      return acc;
    }, {} as Record<string, { total: number; items: number }>);

    return { ...taxTotals, bySupplier };
  }, [shopItemsOnly]);

  const shopItemsWithManualCosts = useMemo(() => {
    const seen = new Set<number>();

    return shopItemsOnly
      .map((item): { partNumber: string; description: string; databaseCost: number; manualCost: number } | null => {
        if (seen.has(item.rowIndex)) return null;
        seen.add(item.rowIndex);

        const effectiveManualCost = getEffectiveManualOverride(
          item.rowIndex,
          item.databaseCost,
          item.manualCost,
        );
        if (effectiveManualCost !== null && item.databaseCost !== null) {
          if (Math.abs(effectiveManualCost - item.databaseCost) > PRICE_MATCH_TOLERANCE) {
            return {
              partNumber: item.partNumber || 'Unknown',
              description: item.description || '—',
              databaseCost: item.databaseCost,
              manualCost: effectiveManualCost,
            };
          }
        }
        return null;
      })
      .filter((item): item is { partNumber: string; description: string; databaseCost: number; manualCost: number } => item !== null);
  }, [draftCosts, shopItemsOnly]);

  // Used by the PDF template for the "Job Information" section.
  // Prefer the explicit list context when present; otherwise derive from the current line items.
  const resolvedListNumber = listNumberContext ?? lineItems[0]?.listNumber ?? null;
  const resolvedArea = lineItems[0]?.area ?? null;

  const handlePoAccountedToggle = async () => {
    if (poAccountedSaving || !onJobMetaUpdated) return;
    const next = !localPoAccounted;
    const previous = localPoAccounted;
    setLocalPoAccounted(next);
    setPoAccountedSaving(true);
    try {
      const response = await fetch(
        `/api/jobs/${encodeURIComponent(jobNumber)}/purchase-order-accounted`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            listNumber: resolvedListNumber?.trim() || '1',
            ...(listNumberContext != null && listNumberContext !== ''
              ? { listNumberContext }
              : {}),
            purchaseOrderAccountedFor: next,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update PO accounted-for');
      }
      if (data.jobMeta) {
        onJobMetaUpdated(data.jobMeta as JobMetadata);
      }
    } catch (err) {
      console.error(err);
      setLocalPoAccounted(previous);
    } finally {
      setPoAccountedSaving(false);
    }
  };

  const setRowSaveState = (rowIndex: number, state: SaveState) => {
    setSaveStates((prev) => {
      const next = new Map(prev);
      next.set(rowIndex, state);
      return next;
    });
  };

  const setRowSaveError = (rowIndex: number, message: string | null) => {
    setSaveErrors((prev) => {
      const next = new Map(prev);
      if (message) {
        next.set(rowIndex, message);
      } else {
        next.delete(rowIndex);
      }
      return next;
    });
  };

  const handleCostChange = (rowIndex: number, value: string) => {
    if (!canEditUnitCost) return;
    setDraftCosts((prev) => {
      const next = new Map(prev);
      next.set(rowIndex, value);
      return next;
    });
    setRowSaveState(rowIndex, 'idle');
    setRowSaveError(rowIndex, null);
  };

  const handleCostBlur = async (item: JobLineItem) => {
    if (!canEditUnitCost) return;
    const rowIndex = item.rowIndex;

    setEditingRows((prev) => {
      const next = new Set(prev);
      next.delete(rowIndex);
      return next;
    });

    const draftValue = draftCosts.get(rowIndex) ?? '';
    const databaseCost = getDatabaseCost(item);
    const parsed = parseDraftCost(draftValue);

    if (parsed === 'invalid') {
      setRowSaveState(rowIndex, 'error');
      setRowSaveError(rowIndex, 'Enter a valid unit cost.');
      return;
    }

    const normalizedManualCost =
      parsed === null
        ? null
        : databaseCost !== null &&
            Math.abs(parsed - databaseCost) <= PRICE_MATCH_TOLERANCE
          ? null
          : parsed;

    const persistedManualCost = item.manualCost ?? null;
    const sameAsSaved =
      (normalizedManualCost === null && persistedManualCost === null) ||
      (normalizedManualCost !== null &&
        persistedManualCost !== null &&
        Math.abs(normalizedManualCost - persistedManualCost) <= PRICE_MATCH_TOLERANCE);

    if (sameAsSaved) {
      setDraftCosts((prev) => {
        const next = new Map(prev);
        next.set(
          rowIndex,
          formatCostInput(persistedManualCost ?? databaseCost),
        );
        return next;
      });
      setRowSaveState(rowIndex, 'idle');
      setRowSaveError(rowIndex, null);
      return;
    }

    const requestToken = (requestTokensRef.current.get(rowIndex) || 0) + 1;
    requestTokensRef.current.set(rowIndex, requestToken);

    setRowSaveState(rowIndex, 'saving');
    setRowSaveError(rowIndex, null);

    try {
      const response = await fetch('/api/jobs/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jobNumber,
          listNumberContext,
          updates: [
            {
              rowIndex,
              manualCost: normalizedManualCost,
            },
          ],
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save unit cost');
      }

      if (requestTokensRef.current.get(rowIndex) !== requestToken) {
        return;
      }

      const updatedResponse = data as UpdateJobResponse;
      const updatedItem = updatedResponse.lineItems.find(
        (lineItem) => lineItem.rowIndex === rowIndex,
      );
      const savedManualCost = updatedItem?.manualCost ?? normalizedManualCost;

      onManualCostSaved?.(rowIndex, savedManualCost);
      setDraftCosts((prev) => {
        const next = new Map(prev);
        const displayValue =
          savedManualCost ?? databaseCost;
        next.set(rowIndex, formatCostInput(displayValue));
        return next;
      });
      setRowSaveState(rowIndex, 'saved');
      setRowSaveError(rowIndex, null);

      window.setTimeout(() => {
        setSaveStates((prev) => {
          if (prev.get(rowIndex) !== 'saved') return prev;
          const next = new Map(prev);
          next.set(rowIndex, 'idle');
          return next;
        });
      }, 1500);
    } catch (err) {
      if (requestTokensRef.current.get(rowIndex) !== requestToken) {
        return;
      }

      setRowSaveState(rowIndex, 'error');
      setRowSaveError(rowIndex, (err as Error).message || 'Failed to save unit cost');
    }
  };

  const renderSaveStatus = (rowIndex: number) => {
    const state = saveStates.get(rowIndex) || 'idle';
    if (state === 'idle') return null;

    const label =
      state === 'saving'
        ? 'Saving...'
        : state === 'saved'
          ? 'Saved'
          : 'Save failed';
    const className =
      state === 'saving'
        ? 'text-blue-600 dark:text-blue-400'
        : state === 'saved'
          ? 'text-green-600 dark:text-green-400'
          : 'text-red-600 dark:text-red-400';

    return <div className={`mt-1 text-[11px] font-semibold ${className}`}>{label}</div>;
  };

  const renderSaveError = (rowIndex: number) => {
    const message = saveErrors.get(rowIndex);
    if (!message) return null;

    return <div className="mt-1 text-[11px] font-medium text-red-600 dark:text-red-400">{message}</div>;
  };

  const renderCostInput = (item: LineItemWithCost, mobile = false) => {
    const displayValue =
      draftCosts.get(item.rowIndex) ?? formatCostInput(item.unitCost);

    if (!canEditUnitCost) {
      return (
        <span
          className={
            mobile
              ? 'block text-sm font-semibold text-slate-200'
              : 'text-xs font-semibold text-slate-700 dark:text-slate-200'
          }
          title="Edit unit cost permission required"
        >
          {formatCurrency(item.unitCost)}
        </span>
      );
    }

    return (
      <div className={mobile ? 'w-full' : 'inline-flex flex-col items-end'}>
        <div className="flex items-center gap-1">
          <span className="text-slate-600 dark:text-slate-400">$</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={displayValue}
            onFocus={() => {
              setEditingRows((prev) => {
                const next = new Set(prev);
                next.add(item.rowIndex);
                return next;
              });
            }}
            onChange={(e) => handleCostChange(item.rowIndex, e.target.value)}
            onBlur={() => {
              void handleCostBlur(item);
            }}
            placeholder="0.00"
            className={
              mobile
                ? 'flex-1 px-2 py-1 bg-slate-700/50 border border-slate-600/50 text-white rounded text-xs text-right focus:ring-1 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-500'
                : 'w-20 px-2 py-1 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded text-xs text-right focus:ring-1 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-500 dark:placeholder:text-slate-500'
            }
          />
        </div>
        {renderSaveStatus(item.rowIndex)}
        {renderSaveError(item.rowIndex)}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 rounded-xl backdrop-blur-sm shadow-xl">
        <div className="text-center p-6">
          <div className="relative">
            <div className="absolute inset-0 bg-yellow-500 rounded-full opacity-20 animate-ping"></div>
            <img
              src="/icon.png"
              alt="Total Fire Protection"
              className="h-20 w-20 mx-auto animate-float relative z-10 rounded-2xl shadow-xl"
            />
          </div>
          <p className="text-slate-900 dark:text-white font-bold mt-8 text-2xl">Total Fire Protection</p>
          <p className="text-slate-700 dark:text-slate-400 font-semibold mt-3">Loading pricing data...</p>
          <div className="flex justify-center gap-2 mt-4">
            <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
            <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
            <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {error && (
        <div className="bg-red-500 border border-red-600 rounded-xl p-4 flex items-start space-x-3 shadow-lg shadow-red-500/20 backdrop-blur-sm mb-4">
          <svg className="w-6 h-6 text-white flex-shrink-0 animate-pulse" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-white">Error</h3>
            <p className="text-sm text-white/90 mt-1">{error}</p>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 rounded-xl p-5 shadow-xl backdrop-blur-sm mb-4 flex-shrink-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white shrink-0">
            Purchase Order
          </h2>
          <div className="flex flex-wrap items-center justify-start sm:justify-end gap-3 sm:gap-4">
            {onJobMetaUpdated != null && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={localPoAccounted}
                  aria-labelledby="po-accounted-label"
                  disabled={poAccountedSaving}
                  onClick={() => void handlePoAccountedToggle()}
                  className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800 ${
                    localPoAccounted
                      ? 'bg-purple-600'
                      : 'bg-slate-300 dark:bg-slate-600'
                  } ${poAccountedSaving ? 'opacity-60 cursor-wait' : ''}`}
                >
                  <span
                    className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow transition ${
                      localPoAccounted ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
                <span
                  id="po-accounted-label"
                  className="text-sm font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap"
                >
                  PO accounted for
                </span>
              </div>
            )}
            <PurchaseOrderPDFButton
              jobNumber={jobNumber}
              jobName={jobName}
              listNumber={resolvedListNumber}
              area={resolvedArea}
              itemsWithCost={shopItemsOnly}
              totals={shopTotals}
              itemsWithManualCosts={shopItemsWithManualCosts}
              listNumberContext={listNumberContext}
              onPurchaseOrderPrinted={onJobMetaUpdated}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-slate-600 dark:text-slate-400 text-xs font-semibold mb-1">Job Number</p>
            <p className="text-slate-900 dark:text-white font-bold">{jobNumber}</p>
          </div>
          <div>
            <p className="text-slate-600 dark:text-slate-400 text-xs font-semibold mb-1">Job Name</p>
            <p className="text-slate-900 dark:text-white font-bold truncate">{jobName}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4 flex-shrink-0">
        <div className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 rounded-xl p-5 shadow-xl backdrop-blur-sm">
          <p className="text-slate-600 dark:text-slate-400 text-xs font-semibold uppercase tracking-wide mb-2">Grand Total</p>
          <p className="text-3xl font-bold text-slate-900 dark:text-white">
            ${totals.grandTotal.toFixed(2)}
          </p>
          <p className="text-slate-600 dark:text-slate-400 text-xs mt-2">{itemsWithCost.length} line items</p>
        </div>

        <div className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 rounded-xl p-5 shadow-xl backdrop-blur-sm">
          <p className="text-slate-600 dark:text-slate-400 text-xs font-semibold uppercase tracking-wide mb-3">By Supplier</p>
          <div className="space-y-1.5 max-h-32 overflow-y-auto">
            {Object.entries(totals.bySupplier)
              .sort(([, a], [, b]) => b.total - a.total)
              .map(([supplier, data]) => (
                <div key={supplier} className="bg-gray-100 dark:bg-slate-700/30 px-2 py-1.5 rounded">
                  <div className="flex justify-between items-center mb-0.5">
                    <span className="font-medium text-slate-700 dark:text-slate-300 text-xs">{supplier}</span>
                    <span className="font-bold text-slate-900 dark:text-white text-xs">${data.total.toFixed(2)}</span>
                  </div>
                  {data.source === 'vendor' && data.ordered > 0 && (
                    <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                      {data.received > 0 ? (
                        <span>Received: {data.received} / Ordered: {data.ordered}</span>
                      ) : (
                        <span>Ordered: {data.ordered}</span>
                      )}
                    </div>
                  )}
                  {data.source === 'shop' && (
                    <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                      Pulled:{' '}
                      {itemsWithCost
                        .filter((lineItem) => lineItem.supplier === supplier && lineItem.source === 'shop')
                        .reduce((sum, lineItem) => sum + lineItem.quantityForCost, 0)}
                    </div>
                  )}
                  {data.source === 'vendor' && data.missingCostLines > 0 && (
                    <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                      {data.missingCostLines} line{data.missingCostLines === 1 ? '' : 's'} missing cost
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 rounded-xl overflow-hidden shadow-xl backdrop-blur-sm flex-1 min-h-0 flex flex-col">
        <div className="px-5 py-3 border-b border-gray-200 dark:border-slate-700/50 flex-shrink-0">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Line Items</h3>
        </div>

        <div className="hidden md:block overflow-y-auto flex-1 min-h-0">
          <table className="w-full">
            <thead className="bg-blue-500 dark:bg-slate-700/50 text-white sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Part Number</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Description</th>
                <th className="px-4 py-3 text-center text-xs font-bold uppercase">UOM</th>
                <th className="px-4 py-3 text-center text-xs font-bold uppercase">Qty</th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase">Unit Cost</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Supplier</th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase">Line Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {itemsWithCost.map((item, idx) => (
                <tr
                  key={`${item.rowIndex}-${item.source || 'none'}-${idx}`}
                  className={`transition-all hover:bg-gray-100 dark:hover:bg-slate-700/30 ${idx % 2 === 0 ? 'bg-white dark:bg-slate-800/40' : 'bg-gray-50 dark:bg-slate-800/20'}`}
                >
                  <td className="px-4 py-2.5 text-xs font-mono font-bold text-slate-900 dark:text-white">
                    {item.partNumber || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-700 dark:text-slate-300 max-w-xs truncate">
                    {item.description || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-center text-slate-600 dark:text-slate-400">
                    {item.uom || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-center font-semibold text-slate-900 dark:text-white">
                    {item.quantityForCost || 0}
                  </td>
                  <td className="px-4 py-2.5 text-right align-top">
                    {renderCostInput(item)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-700 dark:text-slate-300">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300">
                      {item.supplier || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-right font-bold text-slate-900 dark:text-white">
                    {formatCurrency(item.lineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-blue-500 dark:bg-slate-700/70 text-white border-t border-gray-200 dark:border-slate-600/50 sticky bottom-0">
              <tr>
                <td colSpan={6} className="px-4 py-3 text-right text-sm font-bold uppercase tracking-wide">
                  TOTAL:
                </td>
                <td className="px-4 py-3 text-right text-xl font-bold">
                  ${totals.grandTotal.toFixed(2)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="md:hidden divide-y divide-slate-700/50 overflow-y-auto flex-1">
          {itemsWithCost.map((item, idx) => (
            <div key={`${item.rowIndex}-${item.source || 'none'}-${idx}`} className="p-4">
              <div className="font-mono text-xs font-bold text-white mb-1">
                {item.partNumber || '—'}
              </div>
              <div className="text-xs text-slate-400 mb-2 line-clamp-2">
                {item.description || '—'}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                <div>
                  <span className="text-slate-500">UOM:</span>
                  <span className="ml-1 font-medium text-slate-300">{item.uom || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-500">Qty:</span>
                  <span className="ml-1 font-medium text-white">{item.quantityForCost || 0}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500 block mb-1">Unit Cost:</span>
                  {renderCostInput(item, true)}
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500">Supplier:</span>
                  <span className="ml-1 font-medium text-slate-300">{item.supplier || '—'}</span>
                </div>
              </div>
              <div className="pt-2 border-t border-slate-700/50 flex justify-between items-center">
                <span className="text-xs text-slate-400">Line Total:</span>
                <span className="text-sm font-bold text-white">
                  {formatCurrency(item.lineTotal)}
                </span>
              </div>
            </div>
          ))}

          <div className="p-4 bg-slate-700/70 text-white border-t border-slate-600/50">
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold uppercase tracking-wide">TOTAL:</span>
              <span className="text-xl font-bold">
                ${totals.grandTotal.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
