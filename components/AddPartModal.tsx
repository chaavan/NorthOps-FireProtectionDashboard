'use client';

import { useState, useEffect } from 'react';
import { formatVendorDisplay, normalizeVendorKey } from '@/lib/vendorUtils';

interface AddPartModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export default function AddPartModal({ isOpen, onClose, onSuccess }: AddPartModalProps) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [vendors, setVendors] = useState<string[]>([]);
    const [isLoadingVendors, setIsLoadingVendors] = useState(false);
    const [isAddingNewVendor, setIsAddingNewVendor] = useState(false);
    const [newVendorName, setNewVendorName] = useState('');

    const [formData, setFormData] = useState({
        pn: '',
        nomenclature: '',
        units: 'EA',
        cost: '',
        vendor: '',
        altPN: '',
        vendorPartID: '',
        initialQuantity: '0',
        reorderPoint: '',
        orderMinimum: '',
        company: '2',
        whse: '1',
        type: '1',
    });

    useEffect(() => {
        if (isOpen) {
            fetchVendors();
        }
    }, [isOpen]);

    const fetchVendors = async () => {
        try {
            setIsLoadingVendors(true);
            const response = await fetch('/api/parts/vendors');
            if (response.ok) {
                const data = await response.json();
                setVendors(data.vendors || []);
            }
        } catch (err) {
            console.error('Error fetching vendors:', err);
        } finally {
            setIsLoadingVendors(false);
        }
    };

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        let finalVendor = formData.vendor;
        if (isAddingNewVendor) {
            if (!newVendorName.trim()) {
                setError('New vendor name is required');
                return;
            }
            finalVendor = normalizeVendorKey(newVendorName);
        } else if (!finalVendor) {
            setError('Please select a vendor');
            return;
        } else {
            finalVendor = normalizeVendorKey(finalVendor);
        }

        const minOnHand = parseInt(formData.reorderPoint, 10);
        const orderMin = parseInt(formData.orderMinimum, 10);
        if (!Number.isFinite(minOnHand) || minOnHand <= 0) {
            setError('Minimum On Hand must be a number greater than 0');
            return;
        }
        if (!Number.isFinite(orderMin) || orderMin <= 0) {
            setError('Order Minimum must be a number greater than 0');
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            const response = await fetch('/api/admin/parts/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    ...formData,
                    vendor: finalVendor,
                }),
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.message || data.error || 'Failed to create part');
            }

            onSuccess();
            onClose();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));

        if (name === 'vendor') {
            if (value === 'ADD_NEW_VENDOR') {
                setIsAddingNewVendor(true);
            } else {
                setIsAddingNewVendor(false);
            }
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700/50 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-slate-700/50 flex-shrink-0">
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Add New Part</h2>
                    <button
                        onClick={onClose}
                        className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
                    {error && (
                        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/50 text-red-700 dark:text-red-400 p-4 rounded-xl text-sm font-medium">
                            {error}
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Row 1: PN and Supplier Part # */}
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-900 dark:text-slate-400">Part Number (PN) *</label>
                            <input
                                required
                                type="text"
                                name="pn"
                                value={formData.pn}
                                onChange={handleChange}
                                placeholder="e.g. 123-ABC"
                                className="w-full px-4 py-2.5 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 rounded-xl focus:ring-2 focus:ring-blue-500/50 outline-none text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 transition-all"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-900 dark:text-slate-400">Supplier Part #</label>
                            <input
                                type="text"
                                name="vendorPartID"
                                value={formData.vendorPartID}
                                onChange={handleChange}
                                placeholder="e.g. V-7890"
                                className="w-full px-4 py-2.5 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 rounded-xl focus:ring-2 focus:ring-blue-500/50 outline-none text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 transition-all"
                            />
                        </div>

                        {/* Row 2: Description (Full Width) */}
                        <div className="space-y-2 md:col-span-2">
                            <label className="text-sm font-semibold text-slate-900 dark:text-slate-400">Description / Nomenclature *</label>
                            <input
                                required
                                type="text"
                                name="nomenclature"
                                value={formData.nomenclature}
                                onChange={handleChange}
                                placeholder="e.g. 4 inch Grooved Flex Coupling"
                                className="w-full px-4 py-2.5 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 rounded-xl focus:ring-2 focus:ring-blue-500/50 outline-none text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 transition-all"
                            />
                        </div>

                        {/* Row 3: Units and Vendor */}
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-900 dark:text-slate-400">Units (UOM) *</label>
                            <input
                                required
                                type="text"
                                name="units"
                                value={formData.units}
                                onChange={handleChange}
                                placeholder="EA, FT, etc."
                                className="w-full px-4 py-2.5 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 rounded-xl focus:ring-2 focus:ring-blue-500/50 outline-none text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 transition-all"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-900 dark:text-slate-400">Vendor *</label>
                            {!isAddingNewVendor ? (
                                <select
                                    required
                                    name="vendor"
                                    value={formData.vendor}
                                    onChange={handleChange}
                                    className="w-full px-4 py-2.5 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 rounded-xl focus:ring-2 focus:ring-blue-500/50 outline-none text-slate-900 dark:text-white transition-all appearance-none"
                                >
                                    <option value="">Select a vendor...</option>
                                    {vendors.map(v => (
                                        <option key={v} value={v}>{formatVendorDisplay(v)}</option>
                                    ))}
                                    <option value="ADD_NEW_VENDOR" className="text-blue-600 dark:text-blue-400 font-bold">+ Add New Vendor...</option>
                                </select>
                            ) : (
                                <div className="flex gap-2">
                                    <input
                                        required
                                        autoFocus
                                        type="text"
                                        placeholder="New Vendor Name"
                                        value={newVendorName}
                                        onChange={(e) => setNewVendorName(e.target.value)}
                                        className="flex-1 px-4 py-2.5 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 rounded-xl focus:ring-2 focus:ring-blue-500/50 outline-none text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 transition-all"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setIsAddingNewVendor(false);
                                            setFormData(prev => ({ ...prev, vendor: '' }));
                                        }}
                                        className="px-3 bg-gray-100 dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 rounded-xl text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                                        title="Cancel"
                                    >
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Row 4: Initial Quantity and Cost */}
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-900 dark:text-slate-400">Initial Quantity</label>
                            <input
                                type="number"
                                name="initialQuantity"
                                value={formData.initialQuantity}
                                onChange={handleChange}
                                min={0}
                                step={1}
                                className="w-full px-4 py-2.5 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 rounded-xl focus:ring-2 focus:ring-blue-500/50 outline-none text-slate-900 dark:text-white transition-all"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-900 dark:text-slate-400">Cost ($) *</label>
                            <input
                                required
                                type="number"
                                step="0.01"
                                name="cost"
                                value={formData.cost}
                                onChange={handleChange}
                                className="w-full px-4 py-2.5 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 rounded-xl focus:ring-2 focus:ring-blue-500/50 outline-none text-slate-900 dark:text-white transition-all"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-900 dark:text-slate-400">Minimum On Hand *</label>
                            <input
                                required
                                type="number"
                                name="reorderPoint"
                                value={formData.reorderPoint}
                                onChange={handleChange}
                                min={1}
                                step={1}
                                placeholder="e.g. 10"
                                className="w-full px-4 py-2.5 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 rounded-xl focus:ring-2 focus:ring-blue-500/50 outline-none text-slate-900 dark:text-white transition-all"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-900 dark:text-slate-400">Order Minimum *</label>
                            <input
                                required
                                type="number"
                                name="orderMinimum"
                                value={formData.orderMinimum}
                                onChange={handleChange}
                                min={1}
                                step={1}
                                placeholder="e.g. 25"
                                className="w-full px-4 py-2.5 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 rounded-xl focus:ring-2 focus:ring-blue-500/50 outline-none text-slate-900 dark:text-white transition-all"
                            />
                        </div>
                    </div>

                    <div className="pt-6 border-t border-gray-200 dark:border-slate-700/50 flex gap-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-6 py-3 bg-gray-100 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 rounded-xl font-bold hover:bg-gray-200 dark:hover:bg-slate-700/70 border border-gray-300 dark:border-slate-600/50 transition-all"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50"
                        >
                            {isSubmitting ? 'Creating...' : 'Create Part'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
