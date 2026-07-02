"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Plus, Search, X } from "lucide-react";
import VendorCard from "@/components/vendors/VendorCard";
import VendorFormModal, { type VendorFormMode, type VendorFormValues } from "@/components/vendors/VendorFormModal";
import {
  filterUnifiedVendors,
  type VendorFilter,
} from "@/components/vendors/vendorHubUtils";
import type { UnifiedVendor } from "@/lib/vendorService";

type VendorsHubModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

const FILTER_OPTIONS: Array<{ id: VendorFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready" },
  { id: "needs_setup", label: "Needs setup" },
  { id: "inactive", label: "Inactive" },
];

export default function VendorsHubModal({ isOpen, onClose }: VendorsHubModalProps) {
  const [vendors, setVendors] = useState<UnifiedVendor[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<VendorFilter>("all");

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<VendorFormMode>("create");
  const [editingVendor, setEditingVendor] = useState<UnifiedVendor | null>(null);
  const [presetVendorKey, setPresetVendorKey] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const loadVendors = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/admin/vendors", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to load vendors");
      }
      setVendors((data.vendors || []) as UnifiedVendor[]);
    } catch (error) {
      setLoadError((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void loadVendors();
  }, [isOpen, loadVendors]);

  const filteredVendors = useMemo(
    () => filterUnifiedVendors(vendors, filter, search),
    [vendors, filter, search],
  );

  const counts = useMemo(() => {
    return {
      all: vendors.length,
      ready: vendors.filter((vendor) => vendor.setupStatus === "ready").length,
      needs_setup: vendors.filter(
        (vendor) => vendor.setupStatus === "needs_setup" || vendor.setupStatus === "inventory_only",
      ).length,
      inactive: vendors.filter((vendor) => vendor.setupStatus === "inactive").length,
    };
  }, [vendors]);

  const openCreateForm = () => {
    setFormMode("create");
    setEditingVendor(null);
    setPresetVendorKey(null);
    setFormError(null);
    setFormOpen(true);
  };

  const openConfigureForm = (vendor: UnifiedVendor) => {
    setFormMode("configure");
    setEditingVendor(vendor);
    setPresetVendorKey(vendor.vendorKey);
    setFormError(null);
    setFormOpen(true);
  };

  const openEditForm = (vendor: UnifiedVendor) => {
    if (!vendor.id) {
      openConfigureForm(vendor);
      return;
    }
    setFormMode("edit");
    setEditingVendor(vendor);
    setPresetVendorKey(null);
    setFormError(null);
    setFormOpen(true);
  };

  const handleSubmitForm = async (values: VendorFormValues) => {
    setIsSaving(true);
    setFormError(null);
    try {
      const payload = {
        displayName: values.displayName.trim(),
        toEmails: values.toEmails,
        ccEmails: values.ccEmails,
        isActive: values.isActive,
        vendorKeyOverride: presetVendorKey ?? undefined,
      };

      const response = await fetch(
        formMode === "edit" && editingVendor?.id
          ? `/api/admin/vendors/${editingVendor.id}`
          : "/api/admin/vendors",
        {
          method: formMode === "edit" ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to save vendor");
      }

      setFormOpen(false);
      setEditingVendor(null);
      setPresetVendorKey(null);
      await loadVendors();
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleArchive = async (vendor: UnifiedVendor) => {
    if (!vendor.id) return;
    if (!window.confirm(`Archive ${vendor.displayName}? It will be hidden from vendor dropdowns.`)) {
      return;
    }

    setArchivingId(vendor.id);
    try {
      const response = await fetch(`/api/admin/vendors/${vendor.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to archive vendor");
      }
      await loadVendors();
    } catch (error) {
      setLoadError((error as Error).message);
    } finally {
      setArchivingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        onClick={(event) => {
          if (event.target === event.currentTarget && !formOpen) onClose();
        }}
      >
        <div
          className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="border-b border-slate-200 bg-slate-50 px-6 py-5 dark:border-slate-700/60 dark:bg-slate-800/50">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-white">
                  <Building2 className="h-5 w-5" strokeWidth={2.25} aria-hidden />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Vendors</h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Manage suppliers and purchase order email routing
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-white"
                aria-label="Close vendors hub"
              >
                <X className="h-5 w-5" strokeWidth={2} aria-hidden />
              </button>
            </div>

            <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  strokeWidth={2}
                  aria-hidden
                />
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search vendors, keys, or emails..."
                  className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-700/50 dark:text-white"
                />
              </div>
              <button
                type="button"
                onClick={() => openCreateForm()}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden />
                Add Vendor
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {FILTER_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setFilter(option.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    filter === option.id
                      ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700/50 dark:text-slate-300 dark:hover:bg-slate-700"
                  }`}
                >
                  {option.label} ({counts[option.id]})
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {loadError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
                {loadError}
              </div>
            ) : null}

            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-slate-500 dark:text-slate-400">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-blue-500" />
              </div>
            ) : filteredVendors.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-6 py-16 text-center dark:border-slate-600">
                <p className="text-base font-semibold text-slate-700 dark:text-slate-200">No vendors found</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {search.trim() || filter !== "all"
                    ? "Try a different search or filter."
                    : "Add your first vendor to start routing purchase orders."}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filteredVendors.map((vendor) => (
                  <VendorCard
                    key={vendor.id ?? vendor.vendorKey}
                    vendor={vendor}
                    onEdit={openEditForm}
                    onConfigure={openConfigureForm}
                    onArchive={handleArchive}
                    isArchiving={archivingId === vendor.id}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <VendorFormModal
        isOpen={formOpen}
        mode={formMode}
        initialVendor={editingVendor}
        presetVendorKey={presetVendorKey}
        isSaving={isSaving}
        error={formError}
        onClose={() => {
          if (isSaving) return;
          setFormOpen(false);
          setEditingVendor(null);
          setPresetVendorKey(null);
          setFormError(null);
        }}
        onSubmit={handleSubmitForm}
      />
    </>
  );
}
