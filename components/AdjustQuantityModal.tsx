'use client';

import { useState, useEffect } from 'react';

interface Part {
  id: string;
  pn: string;
  nomenclature: string;
  quantity: number;
}

export type AdjustQuantitySuccessPart = {
  id: string;
  quantity: number;
  updatedAt?: string;
};

interface AdjustQuantityModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updated: AdjustQuantitySuccessPart) => void;
  part: Part;
}

const REASON_OPTIONS = [
  { value: 'COUNT', label: 'Physical count / cycle count' },
  { value: 'STOCK_IN', label: 'Stock in' },
  { value: 'DAMAGE', label: 'Damage / scrap' },
  { value: 'SUPPLIER', label: 'Supplier / receipt correction' },
  { value: 'CORRECTION', label: 'Data entry correction' },
  { value: 'OTHER', label: 'Other' },
] as const;

export default function AdjustQuantityModal({ isOpen, onClose, onSuccess, part }: AdjustQuantityModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adjustment, setAdjustment] = useState<string>('0');
  const [reasonCode, setReasonCode] = useState<string>('COUNT');
  const [reasonDetail, setReasonDetail] = useState<string>('');

  useEffect(() => {
    if (!isOpen) return;
    setAdjustment('0');
    setReasonCode('COUNT');
    setReasonDetail('');
    setError(null);
    setIsSubmitting(false);
  }, [isOpen, part.id]);

  if (!isOpen) return null;

  const currentQty = part.quantity;
  const adjNum = parseInt(adjustment, 10);
  const adjValid = !Number.isNaN(adjNum) ? adjNum : 0;
  const resultingQty = currentQty + adjValid;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (adjValid === 0) {
      setError('Adjustment amount must be different from zero');
      return;
    }

    if (resultingQty < 0) {
      setError('Resulting quantity cannot be negative');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/parts/adjust-quantity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          partId: part.id,
          quantityDelta: adjValid,
          reasonCode,
          reasonDetail: reasonDetail.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to adjust quantity');
      }

      const raw = data.part as { id?: string; quantity?: unknown; updatedAt?: unknown } | undefined;
      if (!raw?.id) {
        throw new Error('Invalid response from server');
      }

      onSuccess({
        id: raw.id,
        quantity: Number(raw.quantity),
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700/50 rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-slate-700/50">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Adjust quantity</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="bg-gray-50 dark:bg-slate-900/50 rounded-xl p-4 border border-gray-200 dark:border-slate-700/50">
            <p className="text-sm text-slate-600 dark:text-slate-400 font-medium mb-1">Part</p>
            <p className="text-slate-900 dark:text-white font-bold">{part.pn}</p>
            <p className="text-xs text-slate-600 dark:text-slate-500 mt-1 truncate">{part.nomenclature}</p>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/50 text-red-700 dark:text-red-400 p-3 rounded-lg text-sm font-medium">
              {error}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <div className="p-3 bg-gray-100 dark:bg-slate-700/30 rounded-xl">
              <p className="text-xs text-slate-600 dark:text-slate-500 font-bold uppercase mb-1">Current</p>
              <p className="text-lg font-bold text-slate-900 dark:text-white">{currentQty.toLocaleString()}</p>
            </div>
            <div className="p-3 bg-slate-100 dark:bg-slate-800/50 rounded-xl">
              <p className="text-xs text-slate-600 dark:text-slate-500 font-bold uppercase mb-1">Delta</p>
              <p
                className={`text-lg font-bold ${adjValid > 0 ? 'text-green-600 dark:text-green-400' : adjValid < 0 ? 'text-red-500 dark:text-red-400' : 'text-slate-500'}`}
              >
                {adjValid > 0 ? '+' : ''}
                {adjValid.toLocaleString()}
              </p>
            </div>
            <div
              className={`p-3 rounded-xl ${resultingQty < 0 ? 'bg-red-50 dark:bg-red-900/20' : 'bg-blue-50 dark:bg-blue-900/20'}`}
            >
              <p className="text-xs text-slate-600 dark:text-slate-500 font-bold uppercase mb-1">After</p>
              <p
                className={`text-lg font-bold ${resultingQty < 0 ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}
              >
                {resultingQty.toLocaleString()}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700 dark:text-slate-400">Adjustment (+/-)</label>
              <input
                required
                type="number"
                value={adjustment}
                onChange={(e) => setAdjustment(e.target.value)}
                placeholder="e.g. 50 or -10"
                className="w-full px-4 py-3 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 rounded-xl focus:ring-2 focus:ring-blue-500/50 outline-none text-slate-900 dark:text-white text-lg font-bold placeholder:text-slate-500 dark:placeholder:text-slate-400 transition-all"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700 dark:text-slate-400">Reason category</label>
              <select
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                className="w-full px-4 py-3 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 rounded-xl text-slate-900 dark:text-white text-sm"
              >
                {REASON_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700 dark:text-slate-400">Reason detail (required)</label>
              <textarea
                value={reasonDetail}
                onChange={(e) => setReasonDetail(e.target.value)}
                placeholder="What happened? Be specific enough for an audit trail."
                rows={3}
                required
                minLength={10}
                className="w-full px-4 py-3 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 rounded-xl focus:ring-2 focus:ring-blue-500/50 outline-none text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 transition-all text-sm"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                At least 10 characters for the audit trail. For Other, be explicit about what happened (the server also requires at least 5 characters in this field when Other is selected).
              </p>
            </div>
          </div>

          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 bg-gray-100 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 rounded-xl font-bold hover:bg-gray-200 dark:hover:bg-slate-700/70 transition-all border border-gray-300 dark:border-slate-600/50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || adjValid === 0 || resultingQty < 0}
              className="flex-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : 'Save adjustment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
