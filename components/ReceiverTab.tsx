'use client';

import { useState, useEffect, useMemo } from 'react';
import type { JobLineItem } from '@/lib/types';

interface EditableFields {
  receivedFromOrder?: string;
  partNumber?: string;
  description?: string;
  uom?: string;
  quantityNeeded?: number;
  quantityOrdered?: number;
  supplier?: string; // Selected supplier from dropdown
}

interface ReceiverTabProps {
  lineItems: JobLineItem[];
  onSave: (updates: Map<number, EditableFields>) => Promise<void>;
  isSaving: boolean;
}

export default function ReceiverTab({
  lineItems,
  onSave,
  isSaving,
}: ReceiverTabProps) {
  // Local state for edits
  const [edits, setEdits] = useState<Map<number, EditableFields>>(
    new Map()
  );
  
  // State for supplier lookup
  const [suppliers, setSuppliers] = useState<Map<string, string>>(new Map());
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);
  
  // Available supplier options (common suppliers)
  const supplierOptions = ['ETNA', 'GALLOUP', 'VIKING', 'CORE & MAIN', 'CORE MAIN', 'ARGCO', 'RELIABLE', 'MACOMB', 'OTHER'];

  // Filter to only show ordered items
  const orderedItems = useMemo(() => {
    return lineItems.filter((item) => 
      item.ordered?.toLowerCase() === 'yes'
    );
  }, [lineItems]);

  // Fetch suppliers for all ordered items
  useEffect(() => {
    const fetchSuppliers = async () => {
      if (orderedItems.length === 0) return;

      setLoadingSuppliers(true);
      try {
        // Get all part numbers
        const partNumbers = orderedItems
          .map(item => item.partNumber)
          .filter((pn): pn is string => !!pn);

        if (partNumbers.length === 0) {
          setLoadingSuppliers(false);
          return;
        }

        // Fetch suppliers from API
        const response = await fetch(`/api/parts/suppliers?partNumbers=${encodeURIComponent(partNumbers.join(','))}`);
        if (!response.ok) {
          console.error('Failed to fetch suppliers');
          setLoadingSuppliers(false);
          return;
        }

        const data = await response.json();
        const suppliersMap = new Map<string, string>(Object.entries(data.suppliers));
        setSuppliers(suppliersMap);
      } catch (error) {
        console.error('Error fetching suppliers:', error);
      } finally {
        setLoadingSuppliers(false);
      }
    };

    fetchSuppliers();
  }, [orderedItems]);

  // Check if item is received
  const isReceived = (item: JobLineItem) => {
    const edit = edits.get(item.rowIndex);
    if (edit && edit.receivedFromOrder !== undefined) {
      return edit.receivedFromOrder === 'Yes';
    }
    return item.receivedFromOrder?.toLowerCase() === 'yes';
  };

  // Update a single field for an item
  const updateField = (rowIndex: number, field: keyof EditableFields, value: any) => {
    const newEdits = new Map(edits);
    const existing = edits.get(rowIndex) || {};
    newEdits.set(rowIndex, {
      ...existing,
      [field]: value,
    });
    setEdits(newEdits);
    // Debug: log supplier changes
    if (field === 'supplier') {
      console.log(`[ReceiverTab] Supplier updated for rowIndex ${rowIndex}:`, value);
    }
  };

  // Get current value for any field
  const getCurrentFieldValue = (item: JobLineItem, field: keyof JobLineItem): any => {
    const edit = edits.get(item.rowIndex);
    if (edit && (edit as any)[field] !== undefined) {
      return (edit as any)[field];
    }
    return item[field];
  };

  // Get current supplier (from edits, or type field, or database lookup)
  // Priority: edits > item.type (saved supplier) > database supplier from parts
  const getCurrentSupplier = (item: JobLineItem): string => {
    const edit = edits.get(item.rowIndex);
    if (edit && edit.supplier !== undefined) {
      return edit.supplier;
    }
    // Prioritize item.type (the saved supplier) over database supplier from parts
    // This ensures user-selected suppliers are displayed correctly
    if (item.type) {
      return item.type;
    }
    // Fallback to database supplier from parts table
    const supplierFromDB = item.partNumber ? suppliers.get(item.partNumber) : null;
    return supplierFromDB || '';
  };

  // Toggle received status
  const toggleReceived = (item: JobLineItem) => {
    const currentReceived = isReceived(item);
    const newEdits = new Map(edits);
    const existing = edits.get(item.rowIndex) || {};
    newEdits.set(item.rowIndex, {
      ...existing,
      receivedFromOrder: currentReceived ? '' : 'Yes',
    });
    setEdits(newEdits);
  };

  // Mark all as received
  const markAllReceived = () => {
    const newEdits = new Map(edits);
    orderedItems.forEach((item) => {
      if (!isReceived(item)) {
        const existing = edits.get(item.rowIndex) || {};
        newEdits.set(item.rowIndex, {
          ...existing,
          receivedFromOrder: 'Yes',
        });
      }
    });
    setEdits(newEdits);
  };

  // Has unsaved changes
  const hasChanges = edits.size > 0;

  // Handle save
  const handleSave = async () => {
    // Debug: log what's being saved
    console.log('[ReceiverTab] Saving edits:', Array.from(edits.entries()).map(([idx, data]) => ({
      rowIndex: idx,
      supplier: data.supplier,
      ...data
    })));
    await onSave(edits);
    setEdits(new Map()); // Clear edits after successful save
  };

  // Reset edits when lineItems change
  useEffect(() => {
    setEdits(new Map());
  }, [lineItems]);

  if (orderedItems.length === 0) {
    return (
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-8 sm:p-12 text-center backdrop-blur-sm shadow-xl">
        <div className="text-lg font-bold text-white mb-2">
          No items have been ordered yet
        </div>
        <div className="text-slate-400 font-medium">
          Mark items as "Ordered?" in the Puller tab first.
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col gap-3 sm:gap-4 min-h-0">
      {/* Toolbar */}
      <div className="flex-shrink-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 sm:p-5 backdrop-blur-sm shadow-xl">
        <button
          onClick={markAllReceived}
          disabled={isSaving}
          className="w-full sm:w-auto px-6 py-3 bg-green-500 text-white rounded-xl font-semibold text-sm hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-green-500/20"
        >
          Mark All Received
        </button>
        <div className="text-xs sm:text-sm text-slate-300 text-center sm:text-right font-bold bg-slate-700/50 px-3 py-2 rounded-xl">
          Showing {orderedItems.length} ordered items
        </div>
      </div>

      {/* Desktop Table - Hidden on mobile */}
      <div className="hidden md:block flex-1 min-h-0 max-h-full bg-slate-800/60 border border-slate-700/50 rounded-xl overflow-hidden backdrop-blur-sm shadow-xl flex flex-col">
        <div className="flex-1 min-h-0 max-h-full overflow-y-auto overflow-x-auto -mx-0.5">
          <table className="w-full min-w-max">
            <thead className="bg-green-500 text-white sticky top-0 z-20 shadow-lg">
              <tr>
                <th className="px-4 py-4 text-left text-xs font-bold uppercase tracking-wider">
                  Part Number
                </th>
                <th className="px-4 py-4 text-left text-xs font-bold uppercase tracking-wider">
                  Description
                </th>
                <th className="px-4 py-4 text-left text-xs font-bold uppercase tracking-wider">
                  UOM
                </th>
                <th className="px-4 py-4 text-center text-xs font-bold uppercase tracking-wider">
                  Quantity Ordered
                </th>
                <th className="px-4 py-4 text-left text-xs font-bold uppercase tracking-wider">
                  Supplier
                </th>
                <th className="px-4 py-4 text-center text-xs font-bold uppercase tracking-wider">
                  Received?
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {orderedItems.map((item) => {
                const received = isReceived(item);

                return (
                  <tr
                    key={item.rowIndex}
                    className={`hover:bg-slate-700/30 transition-all ${
                      received ? 'bg-green-900/20' : 'bg-yellow-900/20'
                    }`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={getCurrentFieldValue(item, 'partNumber') || ''}
                        onChange={(e) => updateField(item.rowIndex, 'partNumber', e.target.value)}
                        disabled={isSaving}
                        className="w-full px-2 py-1 bg-slate-700/50 border border-slate-600/50 text-white rounded text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-slate-800/50 placeholder:text-slate-500"
                        placeholder="Part #"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={getCurrentFieldValue(item, 'description') || ''}
                        onChange={(e) => updateField(item.rowIndex, 'description', e.target.value)}
                        disabled={isSaving}
                        className="w-full min-w-[200px] px-2 py-1 bg-slate-700/50 border border-slate-600/50 text-white rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-slate-800/50 placeholder:text-slate-500"
                        placeholder="Description"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={getCurrentFieldValue(item, 'uom') || ''}
                        onChange={(e) => updateField(item.rowIndex, 'uom', e.target.value)}
                        disabled={isSaving}
                        className="w-20 px-2 py-1 border border-gray-300 rounded text-sm text-center focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
                        placeholder="UOM"
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input
                        type="number"
                        min="0"
                        value={getCurrentFieldValue(item, 'quantityOrdered') ?? item.quantityOrdered ?? item.quantityNeeded ?? 0}
                        onChange={(e) => updateField(item.rowIndex, 'quantityOrdered', parseInt(e.target.value) || 0)}
                        disabled={isSaving}
                        className="w-20 px-2 py-1 bg-slate-700/50 border border-slate-600/50 text-white rounded text-sm text-center font-semibold focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-slate-800/50"
                      />
                    </td>
                    <td className="px-4 py-3">
                      {loadingSuppliers ? (
                        <span className="text-xs text-gray-500">Loading...</span>
                      ) : (
                        <select
                          value={getCurrentSupplier(item)}
                          onChange={(e) => {
                            const newValue = e.target.value;
                            console.log(`[ReceiverTab] Supplier dropdown changed for rowIndex ${item.rowIndex}:`, {
                              newValue,
                              currentValue: getCurrentSupplier(item),
                              itemType: item.type,
                              hasEdit: edits.has(item.rowIndex),
                              editSupplier: edits.get(item.rowIndex)?.supplier
                            });
                            // Always update, even if value appears the same
                            updateField(item.rowIndex, 'supplier', newValue);
                          }}
                          disabled={isSaving}
                          className="w-full px-2 py-1 bg-slate-700/50 border border-slate-600/50 text-white rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-slate-800/50"
                        >
                          <option value="">— Select Supplier —</option>
                          {supplierOptions.map((supplier) => (
                            <option key={supplier} value={supplier}>
                              {supplier}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={received}
                        onChange={() => toggleReceived(item)}
                        disabled={isSaving}
                        className="w-6 h-6 text-green-500 border-slate-600 rounded focus:ring-2 focus:ring-green-500 disabled:cursor-not-allowed bg-slate-700/50"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Cards - Shown on mobile */}
      <div className="md:hidden flex-1 min-h-0 overflow-y-auto gap-3 flex flex-col">
        {orderedItems.map((item) => {
          const received = isReceived(item);
          
          return (
            <div
              key={item.rowIndex}
              className={`border-2 rounded-2xl p-4 shadow-lg transition-all transform hover:scale-[1.01] ${
                received ? 'bg-gradient-to-br from-green-50 to-emerald-50 border-green-300 shadow-xl' : 'bg-gradient-to-br from-orange-50 to-yellow-50 border-orange-300 shadow-lg'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-2">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Part Number</label>
                    <input
                      type="text"
                      value={getCurrentFieldValue(item, 'partNumber') || ''}
                      onChange={(e) => updateField(item.rowIndex, 'partNumber', e.target.value)}
                      disabled={isSaving}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
                      placeholder="Part Number"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Description</label>
                    <input
                      type="text"
                      value={getCurrentFieldValue(item, 'description') || ''}
                      onChange={(e) => updateField(item.rowIndex, 'description', e.target.value)}
                      disabled={isSaving}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
                      placeholder="Description"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">UOM</label>
                      <input
                        type="text"
                        value={getCurrentFieldValue(item, 'uom') || ''}
                        onChange={(e) => updateField(item.rowIndex, 'uom', e.target.value)}
                        disabled={isSaving}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm text-center focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
                        placeholder="UOM"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Qty Ordered</label>
                      <input
                        type="number"
                        min="0"
                        value={getCurrentFieldValue(item, 'quantityOrdered') ?? item.quantityOrdered ?? item.quantityNeeded ?? 0}
                        onChange={(e) => updateField(item.rowIndex, 'quantityOrdered', parseInt(e.target.value) || 0)}
                        disabled={isSaving}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm text-center font-semibold focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
                      />
                    </div>
                  </div>
                  <div className="mt-2">
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Supplier</label>
                    {loadingSuppliers ? (
                      <span className="text-xs text-gray-500">Loading supplier...</span>
                    ) : (
                      <select
                        value={getCurrentSupplier(item)}
                        onChange={(e) => updateField(item.rowIndex, 'supplier', e.target.value)}
                        disabled={isSaving}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
                      >
                        <option value="">— Select Supplier —</option>
                        {supplierOptions.map((supplier) => (
                          <option key={supplier} value={supplier}>
                            {supplier}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
                <div className="flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={received}
                    onChange={() => toggleReceived(item)}
                    disabled={isSaving}
                    className="w-7 h-7 text-green-600 border-gray-300 rounded focus:ring-2 focus:ring-green-500 disabled:cursor-not-allowed"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Save Button - Sticky on mobile */}
      <div className="flex-shrink-0 sticky bottom-0 bg-slate-900/95 border-t border-slate-700/50 py-3 -mx-3 px-3 md:static md:border-0 md:p-0 md:mx-0 shadow-xl md:shadow-none z-10 backdrop-blur-xl">
        <button
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
          className="w-full md:w-auto px-8 py-4 bg-blue-500 text-white rounded-xl font-bold text-base hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-500/20"
        >
          {isSaving ? 'Saving...' : hasChanges ? `Save Changes (${edits.size})` : 'No Changes'}
        </button>
      </div>
    </div>
  );
}

