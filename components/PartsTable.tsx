'use client';

import { formatDateInAppTimeZone } from '@/lib/timezone';

interface Part {
  id: string;
  pn: string;
  nomenclature: string;
  quantity: number;
  reorderPoint: number | null;
  units: string;
  vendor: string | null;
  altPN?: string | null;
  vendorPartID?: string | null;
  cost: number;
  retail: number;
  updatedAt: string;
}

interface PartsTableProps {
  parts: Part[];
  isLoading?: boolean;
  onPartClick?: (part: Part) => void;
}

export default function PartsTable({ parts, isLoading, onPartClick }: PartsTableProps) {
  const isLowStock = (part: Part) => {
    if (!part.reorderPoint) return false;
    return part.quantity <= part.reorderPoint;
  };

  if (isLoading) {
    return (
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-700/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Part Number</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Supplier Part #</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Description</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-slate-300">On Hand</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-slate-300">Reorder Point</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Units</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Vendor</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-slate-300">Updated</th>
              </tr>
            </thead>
            <tbody>
              {[...Array(5)].map((_, i) => (
                <tr key={i} className="border-t border-slate-700/50">
                  <td className="px-4 py-3 text-slate-400">
                    <div className="h-4 bg-slate-700/50 rounded animate-pulse"></div>
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    <div className="h-4 bg-slate-700/50 rounded animate-pulse"></div>
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    <div className="h-4 bg-slate-700/50 rounded animate-pulse"></div>
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    <div className="h-4 bg-slate-700/50 rounded animate-pulse"></div>
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    <div className="h-4 bg-slate-700/50 rounded animate-pulse"></div>
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    <div className="h-4 bg-slate-700/50 rounded animate-pulse"></div>
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    <div className="h-4 bg-slate-700/50 rounded animate-pulse"></div>
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    <div className="h-4 bg-slate-700/50 rounded animate-pulse"></div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (parts.length === 0) {
    return (
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-8 text-center">
        <p className="text-slate-400 text-lg">No parts found</p>
        <p className="text-slate-500 text-sm mt-2">Try adjusting your search criteria</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-700/50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Part Number</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Supplier Part #</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Description</th>
              <th className="px-4 py-3 text-right text-sm font-semibold text-slate-300">On Hand</th>
              <th className="px-4 py-3 text-right text-sm font-semibold text-slate-300">Reorder Point</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Units</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Vendor</th>
              <th className="px-4 py-3 text-right text-sm font-semibold text-slate-300">Updated</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((part, index) => (
              <tr
                key={`${part.id}-${index}`}
                className={`border-t border-slate-700/50 hover:bg-slate-700/30 transition-colors ${
                  isLowStock(part) ? 'bg-yellow-900/20' : ''
                } ${onPartClick ? 'cursor-pointer' : ''}`}
                onClick={() => onPartClick?.(part)}
              >
                <td className="px-4 py-3 text-white font-medium">{part.pn}</td>
                  <td className="px-4 py-3 text-slate-300">{part.vendorPartID || part.altPN || '-'}</td>
                <td className="px-4 py-3 text-slate-300 max-w-md truncate" title={part.nomenclature}>
                  {part.nomenclature || '-'}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={`font-semibold ${
                    isLowStock(part) ? 'text-red-400' : 'text-white'
                  }`}>
                    {part.quantity.toLocaleString()}
                  </span>
                  {isLowStock(part) && (
                    <span className="ml-2 px-2 py-0.5 bg-red-600/80 text-white rounded text-xs font-medium">
                      Low Stock
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-slate-400">
                  {part.reorderPoint !== null ? part.reorderPoint.toLocaleString() : '-'}
                </td>
                <td className="px-4 py-3 text-slate-300">{part.units || '-'}</td>
                <td className="px-4 py-3 text-slate-300">{part.vendor || '-'}</td>
                <td className="px-4 py-3 text-right text-sm text-slate-500">
                  {formatDateInAppTimeZone(part.updatedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
