'use client';

import { useState, useEffect } from 'react';
import React from 'react';
import { createPortal } from 'react-dom';
import { pdf } from '@react-pdf/renderer';
import PurchaseOrderPDF from './PurchaseOrderPDF';
import ErrorModal from './ErrorModal';
import { toDateKeyInAppTimeZone } from '@/lib/timezone';
import type { JobMetadata } from '@/lib/types';

interface LineItemWithCost {
  partNumber: string | null;
  description: string | null;
  uom: string | null;
  quantityPulled: number | null;
  quantityNeeded: number | null;
  unitCost: number | null;
  lineTotal: number | null;
  supplier: string | null;
  quantityForCost: number;  // The actual quantity used for cost calculation (shop pull quantity)
  source: 'vendor' | 'shop' | null;  // Track if from vendor order or shop pull
}

interface ManualCostChange {
  partNumber: string;
  description: string | null;
  databaseCost: number;
  manualCost: number;
}

interface PurchaseOrderPDFButtonProps {
  jobNumber: string;
  jobName: string;
  listNumber?: string | null;
  area?: string | null;
  itemsWithCost: LineItemWithCost[];
  totals: {
    subtotal: number;
    salesTaxRate: number;
    salesTaxAmount: number;
    grandTotal: number;
    bySupplier: Record<string, { total: number; items: number }>;
  };
  itemsWithManualCosts: ManualCostChange[];
  /** Same context as the PO tab (for access checks on the server). */
  listNumberContext?: string | null;
  /** Called after a successful PDF download when the server marks PO as accounted for. */
  onPurchaseOrderPrinted?: (jobMeta: JobMetadata) => void;
}

export default function PurchaseOrderPDFButton({
  jobNumber,
  jobName,
  listNumber,
  area,
  itemsWithCost,
  totals,
  itemsWithManualCosts,
  listNumberContext = null,
  onPurchaseOrderPrinted,
}: PurchaseOrderPDFButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [pendingGenerate, setPendingGenerate] = useState(false);
  const [errorModal, setErrorModal] = useState<{
    title: string;
    message: string;
    details?: string | string[];
  } | null>(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const performPDFGeneration = async () => {
    setIsGenerating(true);

    try {
      // Create the PDF document following react-pdf documentation pattern
      const doc = (
        <PurchaseOrderPDF
          jobNumber={jobNumber}
          jobName={jobName}
          listNumber={listNumber}
          area={area}
          itemsWithCost={itemsWithCost}
          totals={totals}
        />
      );

      // Generate PDF blob using the pdf() function as per documentation
      const pdfInstance = pdf(doc);
      const blob = await pdfInstance.toBlob();

      // Create download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `PO-${jobNumber}-${toDateKeyInAppTimeZone(new Date())}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      try {
        const patchRes = await fetch(
          `/api/jobs/${encodeURIComponent(jobNumber)}/purchase-order-accounted`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              listNumber: listNumber?.trim() || '1',
              ...(listNumberContext != null && listNumberContext !== ''
                ? { listNumberContext }
                : {}),
              purchaseOrderAccountedFor: true,
            }),
          },
        );
        if (patchRes.ok) {
          const patchData = await patchRes.json();
          if (patchData?.jobMeta) {
            onPurchaseOrderPrinted?.(patchData.jobMeta as JobMetadata);
          }
        } else {
          console.error(
            'PO accounted-for update failed after print:',
            await patchRes.text(),
          );
        }
      } catch (patchErr) {
        console.error('PO accounted-for update failed after print:', patchErr);
      }
    } catch (error: any) {
      console.error('Error generating PDF:', error);
      setErrorModal({
        title: 'PDF Generation Failed',
        message: `Failed to generate PDF: ${error?.message || 'Unknown error occurred'}`,
      });
    } finally {
      setIsGenerating(false);
      setPendingGenerate(false);
    }
  };

  const handleGeneratePDF = async () => {
    // Validate data before generating
    if (!itemsWithCost || !Array.isArray(itemsWithCost) || itemsWithCost.length === 0 || !totals) {
      setErrorModal({
        title: 'Data Not Ready',
        message: 'Please wait for all data to load before generating the PDF.',
      });
      return;
    }

    // Check if there are any shop items to print
    if (itemsWithCost.length === 0) {
      setErrorModal({
        title: 'No Shop Items',
        message: 'No shop/FAB items to print. This PDF only includes quantities from FAB plus shop pulls. Vendor-ordered quantities are not included.',
      });
      return;
    }

    // Check for missing unit costs
    const itemsWithMissingCosts = itemsWithCost.filter(
      item => item.partNumber && item.unitCost === null
    );

    if (itemsWithMissingCosts.length > 0) {
      const missingParts = itemsWithMissingCosts.map(item => item.partNumber || 'Unknown');
      setErrorModal({
        title: 'Missing Unit Costs',
        message: 'Cannot generate PDF. The following parts are missing unit costs:',
        details: missingParts,
      });
      return;
    }

    // Check for manual cost changes
    if (itemsWithManualCosts && itemsWithManualCosts.length > 0) {
      setPendingGenerate(true);
      setShowWarningModal(true);
      return;
    }

    // No manual changes, proceed directly
    await performPDFGeneration();
  };

  const handleConfirmWarning = async () => {
    setShowWarningModal(false);
    await performPDFGeneration();
  };

  const handleCancelWarning = () => {
    setShowWarningModal(false);
    setPendingGenerate(false);
  };

  // Check if data is ready
  const isDataReady = isMounted && itemsWithCost && Array.isArray(itemsWithCost) && itemsWithCost.length > 0 && totals;

  const manualCostWarningModal =
    showWarningModal && itemsWithManualCosts && itemsWithManualCosts.length > 0 ? (
        <div className="fixed inset-0 z-[9999] overflow-y-auto">
          <div className="flex min-h-full items-center justify-center px-4 py-8 text-center sm:p-0">
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
              onClick={handleCancelWarning}
              aria-hidden
            />

            {/* Modal */}
            <div className="relative z-[10000] inline-block w-full max-w-2xl transform overflow-hidden rounded-2xl border border-yellow-500/50 bg-slate-800/90 text-left align-middle shadow-xl backdrop-blur-sm transition-all">
              <div className="bg-slate-800/60 px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="flex items-start mb-4">
                  <div className="flex-shrink-0">
                    <svg
                      className="h-6 w-6 text-yellow-400"
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
                    <h3 className="text-xl font-bold text-yellow-400 mb-2">
                      Unit Cost Changes Detected
                    </h3>
                    <p className="text-sm text-slate-300 mb-4">
                      You have manually changed the unit cost for {itemsWithManualCosts.length}{' '}
                      {itemsWithManualCosts.length === 1 ? 'item' : 'items'} compared to the
                      database values. Please review the changes below:
                    </p>

                    {/* List of changed items */}
                    <div className="bg-slate-900/50 rounded-lg border border-slate-700/50 max-h-64 overflow-y-auto mb-4">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-700/50 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-bold text-slate-300 uppercase">
                              Part Number
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-bold text-slate-300 uppercase">
                              Description
                            </th>
                            <th className="px-3 py-2 text-right text-xs font-bold text-slate-300 uppercase">
                              Database Cost
                            </th>
                            <th className="px-3 py-2 text-right text-xs font-bold text-yellow-400 uppercase">
                              Your Cost
                            </th>
                            <th className="px-3 py-2 text-right text-xs font-bold text-slate-300 uppercase">
                              Difference
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700/50">
                          {itemsWithManualCosts.map((item, idx) => {
                            const difference = item.manualCost - item.databaseCost;
                            const differencePercent = ((difference / item.databaseCost) * 100).toFixed(1);
                            return (
                              <tr
                                key={idx}
                                className={idx % 2 === 0 ? 'bg-slate-800/30' : 'bg-slate-800/10'}
                              >
                                <td className="px-3 py-2 text-xs font-mono font-semibold text-white">
                                  {item.partNumber}
                                </td>
                                <td className="px-3 py-2 text-xs text-slate-400 max-w-xs truncate">
                                  {item.description || '—'}
                                </td>
                                <td className="px-3 py-2 text-xs text-right text-slate-300">
                                  ${item.databaseCost.toFixed(2)}
                                </td>
                                <td className="px-3 py-2 text-xs text-right font-bold text-yellow-400">
                                  ${item.manualCost.toFixed(2)}
                                </td>
                                <td
                                  className={`px-3 py-2 text-xs text-right font-semibold ${
                                    difference > 0 ? 'text-red-400' : 'text-green-400'
                                  }`}
                                >
                                  {difference > 0 ? '+' : ''}${difference.toFixed(2)} (
                                  {differencePercent}%)
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <p className="text-xs text-slate-400 italic">
                      Click "Continue Anyway" to proceed with printing, or "Cancel" to review and
                      adjust the costs.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-slate-800/40 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse gap-3">
                <button
                  type="button"
                  onClick={handleConfirmWarning}
                  disabled={isGenerating}
                  className="w-full sm:w-auto px-4 py-2 bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-white rounded-xl font-semibold transition-all shadow-lg shadow-yellow-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Continue Anyway
                </button>
                <button
                  type="button"
                  onClick={handleCancelWarning}
                  disabled={isGenerating}
                  className="w-full sm:w-auto px-4 py-2 bg-slate-700/50 text-slate-300 rounded-xl font-semibold hover:bg-slate-700/70 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
    ) : null;

  return (
    <>
    <button
      onClick={handleGeneratePDF}
      disabled={!isDataReady || isGenerating}
      className="px-6 py-3 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-xl font-bold text-sm hover:from-purple-600 hover:to-purple-700 transition-all shadow-lg shadow-purple-500/30 hover:shadow-xl hover:shadow-purple-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {isGenerating ? 'Generating PDF...' : 'Print Order'}
    </button>

      {isMounted && manualCostWarningModal
        ? createPortal(manualCostWarningModal, document.body)
        : null}

      {/* Error Modal */}
      <ErrorModal
        isOpen={errorModal !== null}
        onClose={() => setErrorModal(null)}
        title={errorModal?.title || ''}
        message={errorModal?.message || ''}
        details={errorModal?.details}
      />
    </>
  );
}
