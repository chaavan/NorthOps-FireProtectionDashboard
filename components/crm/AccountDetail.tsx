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
import CrmTagEditor from "@/components/crm/CrmTagEditor";
import CrmAttachmentList from "@/components/crm/CrmAttachmentList";
import {
  CRM_CONTACT_ROLES,
  crmContactRoleLabel,
  crmStageLabel,
  type CrmAccountDetail as CrmAccountDetailType,
} from "@/lib/crm/crmTypes";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800";
const cardClass =
  "rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900";
const sectionTitleClass = "text-sm font-semibold text-slate-900 dark:text-slate-100";

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function AccountDetail({ accountId }: { accountId: string }) {
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

  const [account, setAccount] = useState<CrmAccountDetailType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contactForm, setContactForm] = useState({ name: "", email: "", phone: "", role: "OTHER", locationId: "" });
  const [showContactForm, setShowContactForm] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/crm/accounts/${accountId}`, { cache: "no-store" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to load account");
      setAccount(payload.account);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (!permissionsLoading && canView) void load();
  }, [permissionsLoading, canView, load]);

  const addContact = async () => {
    setError(null);
    try {
      const res = await fetch("/api/crm/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, ...contactForm, locationId: contactForm.locationId || null }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to add contact");
      setContactForm({ name: "", email: "", phone: "", role: "OTHER", locationId: "" });
      setShowContactForm(false);
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
      title={account?.name ?? "Account"}
      subtitle={account ? `${account.accountType} · ${account.salesRepEmail ?? "Unassigned"}` : "Loading…"}
      headerActions={
        <button type="button" onClick={() => router.push("/crm")} className={inventorySecondaryButtonClass}>
          ← Back to CRM
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
      {isLoading || !account ? (
        <div className="flex justify-center py-16">
          <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-blue-500" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            {/* Tags */}
            <div className={cardClass}>
              <h2 className={`${sectionTitleClass} mb-3`}>Tags</h2>
              <CrmTagEditor entityType="ACCOUNT" entityId={account.id} canEdit={canEdit} />
            </div>

            {/* Activity timeline */}
            <div className={cardClass}>
              <h2 className={`${sectionTitleClass} mb-3`}>Activity</h2>
              <CrmActivityTimeline entityType="ACCOUNT" entityId={account.id} accountId={account.id} canEdit={canEdit} />
            </div>

            {/* Contacts */}
            <div className={cardClass}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className={sectionTitleClass}>Contacts ({account.contacts.length})</h2>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => setShowContactForm((prev) => !prev)}
                    className={inventorySecondaryButtonClass}
                  >
                    {showContactForm ? "Cancel" : "+ Add contact"}
                  </button>
                ) : null}
              </div>

              {showContactForm ? (
                <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    className={inputClass}
                    placeholder="Name"
                    value={contactForm.name}
                    onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                  />
                  <select
                    className={inputClass}
                    value={contactForm.role}
                    onChange={(e) => setContactForm({ ...contactForm, role: e.target.value })}
                  >
                    {CRM_CONTACT_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {crmContactRoleLabel(role)}
                      </option>
                    ))}
                  </select>
                  <input
                    className={inputClass}
                    placeholder="Email"
                    value={contactForm.email}
                    onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                  />
                  <input
                    className={inputClass}
                    placeholder="Phone"
                    value={contactForm.phone}
                    onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                  />
                  <div className="sm:col-span-2">
                    <button
                      type="button"
                      disabled={!contactForm.name.trim()}
                      onClick={() => void addContact()}
                      className={inventoryPrimaryButtonClass}
                    >
                      Save contact
                    </button>
                  </div>
                </div>
              ) : null}

              {account.contacts.length === 0 ? (
                <p className="text-sm text-slate-500">No contacts yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {account.contacts.map((contact) => (
                    <li key={contact.id} className="flex items-center justify-between py-2">
                      <div>
                        <Link
                          href={`/crm/contacts/${contact.id}`}
                          className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
                        >
                          {contact.name}
                        </Link>
                        <span className="ml-2 text-xs text-slate-500">{crmContactRoleLabel(contact.role)}</span>
                        {contact.isPrimary ? (
                          <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                            Primary
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-slate-500">{contact.email ?? contact.phone ?? "—"}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Opportunities */}
            <div className={cardClass}>
              <h2 className={`${sectionTitleClass} mb-3`}>Opportunities ({account.opportunities.length})</h2>
              {account.opportunities.length === 0 ? (
                <p className="text-sm text-slate-500">No opportunities yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {account.opportunities.map((opp) => (
                    <li key={opp.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="text-slate-800 dark:text-slate-200">{opp.title}</span>
                      <span className="flex items-center gap-3">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {crmStageLabel(opp.stage)}
                        </span>
                        <span className="text-slate-500">{formatCurrency(opp.value)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Deficiencies */}
            <div className={cardClass}>
              <h2 className={`${sectionTitleClass} mb-3`}>Deficiencies ({account.deficiencies.length})</h2>
              {account.deficiencies.length === 0 ? (
                <p className="text-sm text-slate-500">No deficiencies logged.</p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {account.deficiencies.map((def) => (
                    <li key={def.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="text-slate-800 dark:text-slate-200">{def.title}</span>
                      <span className="flex items-center gap-3">
                        <span className="text-xs text-slate-500">{def.severity}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {def.status}
                        </span>
                        <span className="text-slate-500">{formatCurrency(def.estimatedValue)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Sidebar column */}
          <div className="space-y-5">
            <div className={cardClass}>
              <h2 className={`${sectionTitleClass} mb-3`}>Tasks</h2>
              <CrmTaskList entityType="ACCOUNT" entityId={account.id} accountId={account.id} canEdit={canEdit} />
            </div>

            <div className={cardClass}>
              <h2 className={`${sectionTitleClass} mb-3`}>Files</h2>
              <CrmAttachmentList entityType="ACCOUNT" entityId={account.id} accountId={account.id} canEdit={canEdit} />
            </div>

            <div className={cardClass}>
              <h2 className={`${sectionTitleClass} mb-3`}>Locations ({account.locations.length})</h2>
              <ul className="space-y-2">
                {account.locations.map((location) => (
                  <li key={location.id} className="text-sm">
                    <div className="font-medium text-slate-800 dark:text-slate-200">
                      {location.name}
                      {location.isPrimary ? <span className="ml-2 text-[10px] text-blue-500">Primary</span> : null}
                    </div>
                    <div className="text-xs text-slate-500">
                      {[location.addressLine1, location.city, location.state].filter(Boolean).join(", ") || "—"}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className={cardClass}>
              <h2 className={`${sectionTitleClass} mb-3`}>Renewals ({account.renewals.length})</h2>
              {account.renewals.length === 0 ? (
                <p className="text-sm text-slate-500">No renewals.</p>
              ) : (
                <ul className="space-y-2">
                  {account.renewals.map((renewal) => (
                    <li key={renewal.id} className="text-sm">
                      <div className="font-medium text-slate-800 dark:text-slate-200">{renewal.contractName}</div>
                      <div className="text-xs text-slate-500">
                        {formatDate(renewal.renewalDate)} · {formatCurrency(renewal.annualValue)} · {renewal.status}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </InventoryPageShell>
  );
}
