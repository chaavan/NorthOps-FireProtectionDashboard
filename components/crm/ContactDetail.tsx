"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import InventoryPageShell, {
  inventoryPrimaryButtonClass,
  inventorySecondaryButtonClass,
} from "@/components/InventoryPageShell";
import { usePermissions } from "@/lib/hooks/usePermissions";
import { permissionLoadingFallback } from "@/lib/clientPermissionChecks";
import CrmActivityTimeline from "@/components/crm/CrmActivityTimeline";
import CrmTaskList from "@/components/crm/CrmTaskList";
import {
  CRM_CONTACT_ROLES,
  crmContactRoleLabel,
  type CrmContactRecord,
} from "@/lib/crm/crmTypes";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800";
const cardClass =
  "rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900";

export default function ContactDetail({ contactId }: { contactId: string }) {
  const router = useRouter();
  const { data: session } = useSession();
  const {
    hasPermission,
    isLoading: permissionsLoading,
    isSuperAdmin,
    isDeveloper,
  } = usePermissions();
  // Match the rest of the app: elevated users are let through optimistically
  // while permissions resolve, instead of deferring the first fetch.
  const loadingFallback = permissionLoadingFallback({
    role: (session?.user as any)?.role,
    isSuperAdmin,
    isDeveloper,
  });
  const canView = permissionsLoading ? loadingFallback : hasPermission("crm.view");
  const canEdit = permissionsLoading ? loadingFallback : hasPermission("crm.edit");

  const [contact, setContact] = useState<CrmContactRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", role: "OTHER", notes: "", isPrimary: false });

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/crm/contacts/${contactId}`, { cache: "no-store" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to load contact");
      const record: CrmContactRecord = payload.contact;
      setContact(record);
      setForm({
        name: record.name,
        email: record.email ?? "",
        phone: record.phone ?? "",
        role: record.role,
        notes: record.notes ?? "",
        isPrimary: record.isPrimary,
      });
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    if (!permissionsLoading && canView) void load();
  }, [permissionsLoading, canView, load]);

  const save = async () => {
    setError(null);
    try {
      const res = await fetch(`/api/crm/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to save contact");
      setIsEditing(false);
      await load();
    } catch (submitError) {
      setError((submitError as Error).message);
    }
  };

  if (!permissionsLoading && !canView) {
    return (
      <InventoryPageShell title="CRM" subtitle="You do not have permission to view CRM.">
        <div className="p-6 text-sm text-slate-500">Access denied.</div>
      </InventoryPageShell>
    );
  }

  return (
    <InventoryPageShell
      title={contact?.name ?? "Contact"}
      subtitle={contact ? crmContactRoleLabel(contact.role) : "Loading…"}
      headerActions={
        <button
          type="button"
          onClick={() => (contact?.accountId ? router.push(`/crm/accounts/${contact.accountId}`) : router.push("/crm"))}
          className={inventorySecondaryButtonClass}
        >
          ← Back
        </button>
      }
      banner={
        error ? (
          <div className="px-6 pt-4">
            <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
              {error}
            </div>
          </div>
        ) : null
      }
      contentScroll
    >
      {isLoading || !contact ? (
        <div className="flex justify-center py-16">
          <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-blue-500" />
        </div>
      ) : (
        <div className="max-w-2xl space-y-5">
          <div className={cardClass}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Contact details</h2>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => (isEditing ? void save() : setIsEditing(true))}
                  className={isEditing ? inventoryPrimaryButtonClass : inventorySecondaryButtonClass}
                >
                  {isEditing ? "Save" : "Edit"}
                </button>
              ) : null}
            </div>

            {isEditing ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input className={inputClass} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <select className={inputClass} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {CRM_CONTACT_ROLES.map((role) => (
                    <option key={role} value={role}>{crmContactRoleLabel(role)}</option>
                  ))}
                </select>
                <input className={inputClass} placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                <input className={inputClass} placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <input type="checkbox" checked={form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} />
                  Primary contact
                </label>
                <textarea className={`${inputClass} sm:col-span-2`} placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            ) : (
              <dl className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-2">
                <div><dt className="text-slate-500">Email</dt><dd className="text-slate-800 dark:text-slate-200">{contact.email ?? "—"}</dd></div>
                <div><dt className="text-slate-500">Phone</dt><dd className="text-slate-800 dark:text-slate-200">{contact.phone ?? "—"}</dd></div>
                <div>
                  <dt className="text-slate-500">Account</dt>
                  <dd>
                    {contact.account ? (
                      <Link href={`/crm/accounts/${contact.account.id}`} className="text-blue-600 hover:underline dark:text-blue-400">
                        {contact.account.name}
                      </Link>
                    ) : "—"}
                  </dd>
                </div>
                <div><dt className="text-slate-500">Primary</dt><dd className="text-slate-800 dark:text-slate-200">{contact.isPrimary ? "Yes" : "No"}</dd></div>
                <div className="sm:col-span-2"><dt className="text-slate-500">Notes</dt><dd className="whitespace-pre-wrap text-slate-800 dark:text-slate-200">{contact.notes ?? "—"}</dd></div>
              </dl>
            )}
          </div>

          <div className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">Tasks</h2>
            <CrmTaskList entityType="CONTACT" entityId={contact.id} accountId={contact.accountId} canEdit={canEdit} />
          </div>

          <div className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">Activity</h2>
            <CrmActivityTimeline
              entityType="CONTACT"
              entityId={contact.id}
              accountId={contact.accountId}
              canEdit={canEdit}
            />
          </div>
        </div>
      )}
    </InventoryPageShell>
  );
}
