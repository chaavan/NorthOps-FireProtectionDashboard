"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import InventoryPageShell, {
  inventoryPrimaryButtonClass,
  inventorySecondaryButtonClass,
  inventoryTabActiveClass,
  inventoryTabInactiveClass,
} from "@/components/InventoryPageShell";
import { usePermissions } from "@/lib/hooks/usePermissions";
import { permissionLoadingFallback } from "@/lib/clientPermissionChecks";
import DashboardBootstrapShell, {
  useAppBootstrap,
  DashboardContentSkeleton,
} from "@/components/DashboardBootstrapShell";
import type {
  CrmAccountRollup,
  CrmDashboardPayload,
  CrmOpportunityRecord,
  CrmOpportunityStage,
  CrmRepPerformance,
} from "@/lib/crm/crmTypes";
import { crmContactRoleLabel } from "@/lib/crm/crmTypes";
import CrmTaskList from "@/components/crm/CrmTaskList";
import CrmPipelineBoard from "@/components/crm/CrmPipelineBoard";

type DashboardView = "pipeline" | "contacts" | "tasks" | "renewals" | "reps" | "accounts" | "workflow";

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function CrmDashboard() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const {
    hasPermission,
    isLoading: permissionsLoading,
    isSuperAdmin,
    isDeveloper,
  } = usePermissions();
  const isBootstrapping = useAppBootstrap();
  // Match the rest of the app: let elevated users through optimistically while
  // permissions are still resolving, rather than blocking every fetch on them.
  const loadingFallback = permissionLoadingFallback({
    role: (session?.user as any)?.role,
    isSuperAdmin,
    isDeveloper,
  });
  const canView = permissionsLoading ? loadingFallback : hasPermission("crm.view");
  const canEdit = permissionsLoading ? loadingFallback : hasPermission("crm.edit");
  const canLinkEstimates = permissionsLoading
    ? loadingFallback
    : hasPermission("crm.link_estimates");

  const [activeView, setActiveView] = useState<DashboardView>("pipeline");
  const [dashboard, setDashboard] = useState<CrmDashboardPayload | null>(null);
  const [opportunities, setOpportunities] = useState<CrmOpportunityRecord[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [estimates, setEstimates] = useState<any[]>([]);
  const [salesRepFilter, setSalesRepFilter] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [accountForm, setAccountForm] = useState({
    name: "",
    locationName: "",
    city: "",
    state: "",
    salesRepEmail: "",
  });
  const [inspectionForm, setInspectionForm] = useState({
    accountId: "",
    deficiencyTitle: "",
    deficiencyDescription: "",
    estimatedValue: "",
  });
  const [renewalForm, setRenewalForm] = useState({
    accountId: "",
    contractName: "",
    renewalDate: "",
    annualValue: "",
  });
  const [linkForm, setLinkForm] = useState({
    deficiencyId: "",
    estimateId: "",
  });

  const [contacts, setContacts] = useState<any[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [contactForm, setContactForm] = useState({ accountId: "", name: "", email: "", phone: "" });

  const loadContacts = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (contactSearch.trim()) params.set("search", contactSearch.trim());
      const response = await fetch(`/api/crm/contacts?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to load contacts");
      setContacts(payload.contacts || []);
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  }, [contactSearch]);

  const createContact = async () => {
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/crm/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contactForm),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to create contact");
      setSuccess("Contact created.");
      setContactForm({ accountId: "", name: "", email: "", phone: "" });
      await loadContacts();
    } catch (submitError) {
      setError((submitError as Error).message);
    }
  };

  const loadDashboard = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (salesRepFilter.trim()) params.set("salesRepEmail", salesRepFilter.trim());
      const [dashboardRes, opportunitiesRes, accountsRes] = await Promise.all([
        fetch(`/api/crm/dashboard?${params.toString()}`, { cache: "no-store" }),
        fetch(`/api/crm/opportunities?${params.toString()}`, { cache: "no-store" }),
        fetch("/api/crm/accounts", { cache: "no-store" }),
      ]);
      const dashboardPayload = await dashboardRes.json();
      const opportunitiesPayload = await opportunitiesRes.json();
      const accountsPayload = await accountsRes.json();
      if (!dashboardRes.ok) throw new Error(dashboardPayload.error || "Failed to load CRM dashboard");
      if (!opportunitiesRes.ok) {
        throw new Error(opportunitiesPayload.error || "Failed to load opportunities");
      }
      if (!accountsRes.ok) throw new Error(accountsPayload.error || "Failed to load accounts");
      setDashboard(dashboardPayload.dashboard);
      setOpportunities(opportunitiesPayload.opportunities || []);
      setAccounts(accountsPayload.accounts || []);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [salesRepFilter]);

  const loadEstimates = useCallback(async () => {
    if (!canLinkEstimates) return;
    try {
      const response = await fetch("/api/crm/estimates", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to load estimates");
      setEstimates(payload.estimates || []);
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  }, [canLinkEstimates]);

  useEffect(() => {
    if (status === "loading" || permissionsLoading) return;
    if (!session) {
      router.push("/login?callbackUrl=/crm");
      return;
    }
    if (!canView) return;
    void loadDashboard();
  }, [session, status, permissionsLoading, canView, router, loadDashboard]);

  useEffect(() => {
    if (activeView === "workflow" && canLinkEstimates) {
      void loadEstimates();
    }
  }, [activeView, canLinkEstimates, loadEstimates]);

  useEffect(() => {
    if (activeView === "contacts" && canView) {
      void loadContacts();
    }
  }, [activeView, canView, loadContacts]);

  const repOptions = useMemo(() => {
    const emails = new Set<string>();
    for (const rep of dashboard?.repPerformance || []) emails.add(rep.salesRepEmail);
    for (const account of accounts) {
      if (account.salesRepEmail) emails.add(account.salesRepEmail);
    }
    return Array.from(emails).sort();
  }, [dashboard, accounts]);

  const openDeficiencies = useMemo(
    () => opportunities.filter((opp) => opp.stage === "DEFICIENCY_IDENTIFIED"),
    [opportunities],
  );

  const [opportunitySearch, setOpportunitySearch] = useState("");
  const filteredOpportunities = useMemo(() => {
    const term = opportunitySearch.trim().toLowerCase();
    if (!term) return opportunities;
    return opportunities.filter(
      (opp) =>
        opp.title.toLowerCase().includes(term) || opp.account.name.toLowerCase().includes(term),
    );
  }, [opportunities, opportunitySearch]);

  const createAccount = async () => {
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/crm/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accountForm),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to create account");
      setSuccess("Account created.");
      setAccountForm({ name: "", locationName: "", city: "", state: "", salesRepEmail: "" });
      await loadDashboard();
    } catch (submitError) {
      setError((submitError as Error).message);
    }
  };

  const createInspection = async () => {
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/crm/inspections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: inspectionForm.accountId,
          deficiencies: [
            {
              title: inspectionForm.deficiencyTitle,
              description: inspectionForm.deficiencyDescription,
              estimatedValue: inspectionForm.estimatedValue
                ? Number(inspectionForm.estimatedValue)
                : null,
            },
          ],
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to create inspection");
      setSuccess("Inspection logged and opportunity created at Deficiency Identified.");
      setInspectionForm({
        accountId: "",
        deficiencyTitle: "",
        deficiencyDescription: "",
        estimatedValue: "",
      });
      await loadDashboard();
    } catch (submitError) {
      setError((submitError as Error).message);
    }
  };

  const createRenewal = async () => {
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/crm/renewals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: renewalForm.accountId,
          contractName: renewalForm.contractName,
          renewalDate: renewalForm.renewalDate,
          annualValue: renewalForm.annualValue ? Number(renewalForm.annualValue) : null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to create renewal");
      setSuccess("Renewal contract added.");
      setRenewalForm({ accountId: "", contractName: "", renewalDate: "", annualValue: "" });
      await loadDashboard();
    } catch (submitError) {
      setError((submitError as Error).message);
    }
  };

  const linkEstimate = async () => {
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/crm/estimates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          estimateId: linkForm.estimateId,
          deficiencyIds: [linkForm.deficiencyId],
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to link estimate");
      setSuccess("Deficiency linked to estimate and moved to Quoted.");
      setLinkForm({ deficiencyId: "", estimateId: "" });
      await loadDashboard();
    } catch (submitError) {
      setError((submitError as Error).message);
    }
  };

  // Throws on failure so the kanban board can roll back its optimistic move.
  const moveOpportunityStage = async (opportunityId: string, stage: CrmOpportunityStage) => {
    const response = await fetch(`/api/crm/opportunities/${encodeURIComponent(opportunityId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stage,
        scheduledAt: stage === "SCHEDULED" ? new Date().toISOString() : undefined,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Failed to update opportunity");
    await loadDashboard();
  };

  if (isBootstrapping) {
    return (
      <DashboardBootstrapShell message="Loading CRM...">
        <DashboardContentSkeleton />
      </DashboardBootstrapShell>
    );
  }

  if (!permissionsLoading && session && !canView) {
    return (
      <InventoryPageShell title="CRM" subtitle="You do not have permission to view CRM.">
        <p className="text-slate-600 dark:text-slate-300">
          Ask an admin to grant the <code>crm.view</code> permission.
        </p>
      </InventoryPageShell>
    );
  }

  return (
    <InventoryPageShell
      title="CRM"
      subtitle="Service-sales pipeline — deficiency → estimate → close → schedule"
      headerActions={
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={salesRepFilter}
            onChange={(event) => setSalesRepFilter(event.target.value)}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
          >
            <option value="">All reps</option>
            {repOptions.map((email) => (
              <option key={email} value={email}>
                {email}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void loadDashboard()} className={inventorySecondaryButtonClass}>
            Refresh
          </button>
        </div>
      }
      banner={
        error || success ? (
          <div className="px-6 pt-4">
            {error ? (
              <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
                {error}
              </div>
            ) : null}
            {success ? (
              <div className="mt-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200">
                {success}
              </div>
            ) : null}
          </div>
        ) : null
      }
      contentScroll
    >
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["pipeline", "Deficiency Pipeline"],
              ["contacts", "Contacts"],
              ["tasks", "My Tasks"],
              ["renewals", "Renewal Calendar"],
              ["reps", "Rep Performance"],
              ["accounts", "Multi-Site Accounts"],
              ["workflow", "Workflow"],
            ] as const
          ).map(([view, label]) => (
            <button
              key={view}
              type="button"
              onClick={() => setActiveView(view)}
              className={activeView === view ? inventoryTabActiveClass : inventoryTabInactiveClass}
            >
              {label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-blue-500" />
          </div>
        ) : null}

        {!isLoading && activeView === "pipeline" && dashboard ? (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {dashboard.pipeline.map((stage) => (
                <div
                  key={stage.stage}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40"
                >
                  <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                    {stage.label}
                  </div>
                  <div className="mt-2 text-3xl font-bold text-slate-900 dark:text-white">
                    {stage.count}
                  </div>
                  <div className="mt-1 text-sm font-medium text-blue-600 dark:text-blue-300">
                    {formatCurrency(stage.value)}
                  </div>
                </div>
              ))}
            </div>

            <input
              value={opportunitySearch}
              onChange={(e) => setOpportunitySearch(e.target.value)}
              placeholder="Filter opportunities by title or account…"
              className="w-80 rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
            />

            <CrmPipelineBoard
              opportunities={filteredOpportunities}
              canEdit={canEdit}
              onStageChange={moveOpportunityStage}
            />
          </div>
        ) : null}

        {!isLoading && activeView === "contacts" ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void loadContacts();
                }}
                placeholder="Search contacts by name, email, or phone…"
                className="w-72 rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              />
              <button type="button" onClick={() => void loadContacts()} className={inventorySecondaryButtonClass}>
                Search
              </button>
            </div>

            {canEdit ? (
              <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <select
                  value={contactForm.accountId}
                  onChange={(e) => setContactForm((prev) => ({ ...prev, accountId: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                >
                  <option value="">Select account…</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
                <input
                  placeholder="Name"
                  value={contactForm.name}
                  onChange={(e) => setContactForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                />
                <input
                  placeholder="Email"
                  value={contactForm.email}
                  onChange={(e) => setContactForm((prev) => ({ ...prev, email: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                />
                <input
                  placeholder="Phone"
                  value={contactForm.phone}
                  onChange={(e) => setContactForm((prev) => ({ ...prev, phone: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                />
                <button
                  type="button"
                  disabled={!contactForm.accountId || !contactForm.name.trim()}
                  onClick={() => void createContact()}
                  className={inventoryPrimaryButtonClass}
                >
                  Add Contact
                </button>
              </div>
            ) : null}

            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800/50">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Account</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Phone</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                        No contacts found.
                      </td>
                    </tr>
                  ) : (
                    contacts.map((contact) => (
                      <tr key={contact.id} className="border-t border-slate-200 dark:border-slate-700">
                        <td className="px-4 py-3 font-medium">
                          <Link href={`/crm/contacts/${contact.id}`} className="text-blue-600 hover:underline dark:text-blue-400">
                            {contact.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3">{crmContactRoleLabel(contact.role)}</td>
                        <td className="px-4 py-3">
                          {contact.account ? (
                            <Link href={`/crm/accounts/${contact.account.id}`} className="text-blue-600 hover:underline dark:text-blue-400">
                              {contact.account.name}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-3">{contact.email ?? "—"}</td>
                        <td className="px-4 py-3">{contact.phone ?? "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {activeView === "tasks" ? (
          <div className="max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
            <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">My open &amp; completed tasks</h2>
            <CrmTaskList mine canEdit={canEdit} />
          </div>
        ) : null}

        {!isLoading && activeView === "renewals" && dashboard ? (
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left dark:bg-slate-900/60">
                <tr>
                  <th className="px-4 py-3">Contract</th>
                  <th className="px-4 py-3">Account</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">Renewal Date</th>
                  <th className="px-4 py-3">Days Left</th>
                  <th className="px-4 py-3">Annual Value</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.renewals.map((renewal) => (
                  <tr key={renewal.id} className="border-t border-slate-200 dark:border-slate-700">
                    <td className="px-4 py-3 font-medium">{renewal.contractName}</td>
                    <td className="px-4 py-3">{renewal.accountName}</td>
                    <td className="px-4 py-3">{renewal.locationName || "All sites"}</td>
                    <td className="px-4 py-3">{formatDate(renewal.renewalDate)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          renewal.urgency === "critical"
                            ? "font-semibold text-rose-600"
                            : renewal.urgency === "warning"
                              ? "font-semibold text-amber-600"
                              : "text-slate-600 dark:text-slate-300"
                        }
                      >
                        {renewal.daysUntilRenewal}d
                      </span>
                    </td>
                    <td className="px-4 py-3">{formatCurrency(renewal.annualValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {!isLoading && activeView === "reps" && dashboard ? (
          <RepTable reps={dashboard.repPerformance} />
        ) : null}

        {!isLoading && activeView === "accounts" && dashboard ? (
          <AccountRollupTable accounts={dashboard.accountRollups} />
        ) : null}

        {!isLoading && activeView === "workflow" && canEdit ? (
          <div className="grid gap-6 xl:grid-cols-2">
            <WorkflowCard title="1. Create account + primary location">
              <input
                placeholder="Account name"
                value={accountForm.name}
                onChange={(e) => setAccountForm((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
              />
              <input
                placeholder="Primary location name"
                value={accountForm.locationName}
                onChange={(e) => setAccountForm((prev) => ({ ...prev, locationName: e.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  placeholder="City"
                  value={accountForm.city}
                  onChange={(e) => setAccountForm((prev) => ({ ...prev, city: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
                />
                <input
                  placeholder="State"
                  value={accountForm.state}
                  onChange={(e) => setAccountForm((prev) => ({ ...prev, state: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
                />
              </div>
              <button type="button" className={inventoryPrimaryButtonClass} onClick={() => void createAccount()}>
                Create Account
              </button>
            </WorkflowCard>

            <WorkflowCard title="2. Log inspection deficiency → auto opportunity">
              <select
                value={inspectionForm.accountId}
                onChange={(e) => setInspectionForm((prev) => ({ ...prev, accountId: e.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
              >
                <option value="">Select account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
              <input
                placeholder="Deficiency title"
                value={inspectionForm.deficiencyTitle}
                onChange={(e) =>
                  setInspectionForm((prev) => ({ ...prev, deficiencyTitle: e.target.value }))
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
              />
              <textarea
                placeholder="Description"
                value={inspectionForm.deficiencyDescription}
                onChange={(e) =>
                  setInspectionForm((prev) => ({ ...prev, deficiencyDescription: e.target.value }))
                }
                className="min-h-24 w-full rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
              />
              <input
                placeholder="Estimated value"
                value={inspectionForm.estimatedValue}
                onChange={(e) =>
                  setInspectionForm((prev) => ({ ...prev, estimatedValue: e.target.value }))
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
              />
              <button type="button" className={inventoryPrimaryButtonClass} onClick={() => void createInspection()}>
                Create Deficiency Pipeline
              </button>
            </WorkflowCard>

            {canLinkEstimates ? (
              <WorkflowCard title="3. Link deficiency to estimate (Quoted)">
                <select
                  value={linkForm.deficiencyId}
                  onChange={(e) => setLinkForm((prev) => ({ ...prev, deficiencyId: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
                >
                  <option value="">Select open deficiency</option>
                  {openDeficiencies.map((opp) => (
                    <option key={opp.id} value={opp.deficiency?.id || ""}>
                      {opp.title} — {opp.account.name}
                    </option>
                  ))}
                </select>
                <select
                  value={linkForm.estimateId}
                  onChange={(e) => setLinkForm((prev) => ({ ...prev, estimateId: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
                >
                  <option value="">Select estimate</option>
                  {estimates.map((estimate) => (
                    <option key={estimate.id} value={estimate.id}>
                      {estimate.title} ({estimate.bidStatus}) — {formatCurrency(estimate.totalCost)}
                    </option>
                  ))}
                </select>
                <button type="button" className={inventoryPrimaryButtonClass} onClick={() => void linkEstimate()}>
                  Link Estimate
                </button>
              </WorkflowCard>
            ) : null}

            <WorkflowCard title="4. Add renewal contract">
              <select
                value={renewalForm.accountId}
                onChange={(e) => setRenewalForm((prev) => ({ ...prev, accountId: e.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
              >
                <option value="">Select account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
              <input
                placeholder="Contract name"
                value={renewalForm.contractName}
                onChange={(e) => setRenewalForm((prev) => ({ ...prev, contractName: e.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
              />
              <input
                type="date"
                value={renewalForm.renewalDate}
                onChange={(e) => setRenewalForm((prev) => ({ ...prev, renewalDate: e.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
              />
              <input
                placeholder="Annual value"
                value={renewalForm.annualValue}
                onChange={(e) => setRenewalForm((prev) => ({ ...prev, annualValue: e.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
              />
              <button type="button" className={inventoryPrimaryButtonClass} onClick={() => void createRenewal()}>
                Add Renewal
              </button>
            </WorkflowCard>
          </div>
        ) : null}
      </div>
    </InventoryPageShell>
  );
}

function WorkflowCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-900/40">
      <h3 className="mb-4 text-lg font-bold text-slate-900 dark:text-white">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function RepTable({ reps }: { reps: CrmRepPerformance[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left dark:bg-slate-900/60">
          <tr>
            <th className="px-4 py-3">Rep</th>
            <th className="px-4 py-3">Open Deficiencies</th>
            <th className="px-4 py-3">Quoted Not Sent</th>
            <th className="px-4 py-3">Sent Open</th>
            <th className="px-4 py-3">Win Rate</th>
            <th className="px-4 py-3">Pipeline Value</th>
          </tr>
        </thead>
        <tbody>
          {reps.map((rep) => (
            <tr key={rep.salesRepEmail} className="border-t border-slate-200 dark:border-slate-700">
              <td className="px-4 py-3 font-medium">{rep.salesRepEmail}</td>
              <td className="px-4 py-3">{rep.openDeficiencies}</td>
              <td className="px-4 py-3">{rep.quotedNotSent}</td>
              <td className="px-4 py-3">{rep.sentOpen}</td>
              <td className="px-4 py-3">{rep.winRate === null ? "—" : `${rep.winRate}%`}</td>
              <td className="px-4 py-3">{formatCurrency(rep.pipelineValue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccountRollupTable({ accounts }: { accounts: CrmAccountRollup[] }) {
  return (
    <div className="space-y-4">
      {accounts.map((account) => (
        <div
          key={account.id}
          className="rounded-xl border border-slate-200 p-4 dark:border-slate-700 dark:bg-slate-900/30"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Link
                href={`/crm/accounts/${account.id}`}
                className="text-lg font-bold text-blue-600 hover:underline dark:text-blue-400"
              >
                {account.name}
              </Link>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {account.locationCount} locations · {account.openDeficiencies} open deficiencies ·{" "}
                {account.activeOpportunities} active opportunities · {account.upcomingRenewals} renewals
              </p>
            </div>
            <div className="text-sm text-slate-500 dark:text-slate-400">
              Rep: {account.salesRepEmail || "Unassigned"}
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {account.locations.map((location) => (
              <div
                key={location.id}
                className="rounded-lg border border-slate-200 bg-white px-3 py-3 dark:border-slate-700 dark:bg-slate-800/50"
              >
                <div className="font-semibold">{location.name}</div>
                <div className="text-sm text-slate-500 dark:text-slate-400">
                  {[location.city, location.state].filter(Boolean).join(", ") || "No address"}
                </div>
                <div className="mt-2 text-sm">
                  {location.openDeficiencies} deficiencies · {location.upcomingRenewals} renewals
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
