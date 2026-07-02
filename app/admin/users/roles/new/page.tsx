"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import AdminRoleShell from "@/components/roles/AdminRoleShell";
import AccessDeniedOverlay from "@/components/AccessDeniedOverlay";
import RoleBadge from "@/components/roles/RoleBadge";
import RoleColorPicker, { isRoleColorValidForSave } from "@/components/roles/RoleColorPicker";
import RoleEditorTabs, { type RoleEditorTab } from "@/components/roles/RoleEditorTabs";
import RolePermissionsEditor from "@/components/roles/RolePermissionsEditor";
import WarningConfirmModal from "@/components/WarningConfirmModal";
import { usePermissions } from "@/lib/hooks/usePermissions";
import { useUnsavedChangesGuard } from "@/lib/hooks/useUnsavedChangesGuard";
import { softwareConfig } from "@/lib/softwareConfig";
import {
  estimatePanel,
  estimatePanelTitle,
} from "@/lib/estimate/estimateUi";
import { findFirstAvailableRoleColor, type RoleColorOwner } from "@/lib/roleBadgeColor";
import { defaultRoleFormValues, ROLES_LIST_HREF, type RoleFormValues } from "@/lib/roleUi";

export default function CreateRolePage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { hasPermission, isLoading: isPermissionsLoading } = usePermissions();
  const isAdmin = (session?.user as any)?.role === "ADMIN";
  const canManage =
    softwareConfig.rolePermissionManagementEnabled &&
    (isPermissionsLoading ? isAdmin : hasPermission("users.permissions.edit"));

  const [activeTab, setActiveTab] = useState<RoleEditorTab>("overview");
  const [form, setForm] = useState<RoleFormValues>(defaultRoleFormValues());
  const [createdRoleKey, setCreatedRoleKey] = useState<string | null>(null);
  const [allRoles, setAllRoles] = useState<RoleColorOwner[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unsavedGuard = useUnsavedChangesGuard();

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/login?callbackUrl=/admin/users/roles/new");
      return;
    }
  }, [router, session, status]);

  useEffect(() => {
    if (!canManage) return;
    void (async () => {
      const response = await fetch("/api/roles?includeArchived=true", { cache: "no-store" });
      const body = await response.json();
      if (response.ok) {
        const loadedRoles = (body.roles || []).map((entry: RoleColorOwner) => ({
          key: entry.key,
          name: entry.name,
          colorClass: entry.colorClass,
        }));
        setAllRoles(loadedRoles);
        setForm((current) => ({
          ...current,
          colorClass: findFirstAvailableRoleColor(loadedRoles),
        }));
      }
    })();
  }, [canManage]);

  const createRole = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, colorClass: form.colorClass }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to create role");
      setCreatedRoleKey(body.role.key);
      setActiveTab("permissions");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const canCreate =
    form.name.trim().length > 0 &&
    isRoleColorValidForSave(form.colorClass, allRoles) &&
    !isSubmitting;

  if (status === "loading" || isPermissionsLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-100 dark:bg-slate-900">
        <p className="text-slate-500">Loading...</p>
      </div>
    );
  }

  if (!canManage) {
    return (
      <AdminRoleShell title="Create role" subtitle="Set the basics, then review permissions for each app page.">
        <div className="pointer-events-none flex min-h-0 flex-1 select-none flex-col gap-4 blur-sm opacity-60">
          <div className="h-28 rounded-2xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60" />
          <div className="flex-1 rounded-2xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60" />
        </div>
        <AccessDeniedOverlay message="You do not have permission to manage role permissions." />
      </AdminRoleShell>
    );
  }

  return (
    <>
    <AdminRoleShell
      title="Create role"
      subtitle="Set the basics, then review permissions for each app page."
      onBeforeNavigate={unsavedGuard.onBeforeNavigate}
      onBeforeLogout={() =>
        unsavedGuard.requestLeave(() => {
          void signOut({ callbackUrl: "/login" });
        })
      }
      badge={<RoleBadge name="New role" colorClass={form.colorClass} />}
      tabs={
        <RoleEditorTabs
          activeTab={activeTab}
          onSelect={setActiveTab}
          permissionsDisabled={!createdRoleKey}
        />
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {error ? (
          <div className="shrink-0 rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white">
            {error}
          </div>
        ) : null}

        {activeTab === "overview" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <section className={`${estimatePanel} mx-auto w-full max-w-3xl space-y-5 p-5 sm:p-6`}>
              <div>
                <h2 className={estimatePanelTitle}>Role basics</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Choose a name and badge color. The role key is generated automatically when you
                  continue.
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-300">
                  Role name
                </label>
                <input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  required
                  placeholder="e.g. Field Technician"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-300">
                  Badge appearance
                </label>
                <RoleColorPicker
                  previewName={form.name}
                  colorClass={form.colorClass}
                  onChange={(colorClass) => setForm({ ...form, colorClass })}
                  allRoles={allRoles}
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => router.push(ROLES_LIST_HREF)}
                  className="rounded-xl bg-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!canCreate}
                  onClick={() => void createRole()}
                  className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {isSubmitting ? "Creating..." : "Continue to permissions"}
                </button>
              </div>
            </section>
          </div>
        ) : createdRoleKey ? (
          <RolePermissionsEditor
            ref={unsavedGuard.targetRef}
            roleKey={createdRoleKey}
            primaryActionLabel="Save & finish"
            onSaved={() => router.push(ROLES_LIST_HREF)}
          />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center dark:border-slate-600 dark:bg-slate-800/60">
            <p className="text-sm text-slate-500">
              Complete the overview step to configure permissions.
            </p>
          </div>
        )}
      </div>
    </AdminRoleShell>
    <WarningConfirmModal
      isOpen={unsavedGuard.isOpen}
      title="Unsaved changes"
      message="You have unsaved permission changes."
      detail="Save them before continuing?"
      confirmLabel="Save & continue"
      cancelLabel="Stay here"
      onConfirm={() => void unsavedGuard.confirmSaveAndLeave()}
      onCancel={unsavedGuard.cancel}
      confirming={unsavedGuard.isResolving}
    />
    </>
  );
}
