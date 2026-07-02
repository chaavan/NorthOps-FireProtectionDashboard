"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import AdminRoleShell from "@/components/roles/AdminRoleShell";
import AccessDeniedOverlay from "@/components/AccessDeniedOverlay";
import RoleBadge from "@/components/roles/RoleBadge";
import RoleEditorTabs, { type RoleEditorTab } from "@/components/roles/RoleEditorTabs";
import RoleOverviewTab from "@/components/roles/RoleOverviewTab";
import RolePermissionsEditor from "@/components/roles/RolePermissionsEditor";
import WarningConfirmModal from "@/components/WarningConfirmModal";
import { usePermissions } from "@/lib/hooks/usePermissions";
import { permissionLoadingFallback } from "@/lib/clientPermissionChecks";
import { useUnsavedChangesGuard } from "@/lib/hooks/useUnsavedChangesGuard";
import { softwareConfig } from "@/lib/softwareConfig";
import type { PermissionKey } from "@/lib/permissionCatalog";
import { isFixedSystemRoleKey } from "@/lib/systemRoleClient";
import type { RoleColorOwner } from "@/lib/roleBadgeColor";
import { defaultRoleFormValues, ROLES_LIST_HREF, type RoleFormValues } from "@/lib/roleUi";

type RoleRecord = {
  key: string;
  name: string;
  colorClass: string | null;
  isSystem: boolean;
  isActive: boolean;
  userCount?: number;
  updatedAt?: string;
};

export default function EditRolePage() {
  const params = useParams<{ key: string }>();
  const roleKey = decodeURIComponent(params?.key ?? "");
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab: RoleEditorTab =
    searchParams?.get("tab") === "permissions" ? "permissions" : "overview";
  const initialPageId = searchParams?.get("page");

  const { data: session, status } = useSession();
  const { hasPermission, isLoading: isPermissionsLoading, isSuperAdmin, isDeveloper } = usePermissions();
  const canManage =
    softwareConfig.rolePermissionManagementEnabled &&
    (isPermissionsLoading
      ? permissionLoadingFallback({
          role: (session?.user as any)?.role,
          isSuperAdmin,
          isDeveloper,
        })
      : hasPermission("users.permissions.edit"));

  const [role, setRole] = useState<RoleRecord | null>(null);
  const [form, setForm] = useState<RoleFormValues>(defaultRoleFormValues());
  const [permissions, setPermissions] = useState<Partial<Record<PermissionKey, boolean>>>({});
  const [allRoles, setAllRoles] = useState<RoleColorOwner[]>([]);
  const [activeTab, setActiveTab] = useState<RoleEditorTab>(initialTab);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const unsavedGuard = useUnsavedChangesGuard();

  const buildRoleUrl = useCallback(
    (tab: RoleEditorTab, pageId?: string | null) => {
      const query = new URLSearchParams();
      if (tab === "permissions") query.set("tab", "permissions");
      if (pageId) query.set("page", pageId);
      const qs = query.toString();
      return `/admin/users/roles/${encodeURIComponent(roleKey)}${qs ? `?${qs}` : ""}`;
    },
    [roleKey],
  );

  useEffect(() => {
    const tab = searchParams?.get("tab") === "permissions" ? "permissions" : "overview";
    setActiveTab(tab);
  }, [searchParams]);

  const selectTab = (tab: RoleEditorTab, pageId?: string | null) => {
    setActiveTab(tab);
    router.replace(buildRoleUrl(tab, pageId ?? (tab === "permissions" ? initialPageId : null)), {
      scroll: false,
    });
  };

  const loadRoleData = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const [roleResponse, permissionsResponse, rolesResponse] = await Promise.all([
        fetch(`/api/roles/${encodeURIComponent(roleKey)}`, { cache: "no-store" }),
        fetch(`/api/roles/${encodeURIComponent(roleKey)}/permissions`, { cache: "no-store" }),
        fetch("/api/roles?includeArchived=true", { cache: "no-store" }),
      ]);

      const roleBody = await roleResponse.json();
      const permissionsBody = await permissionsResponse.json();
      const rolesBody = await rolesResponse.json();

      if (!roleResponse.ok) throw new Error(roleBody.error || "Failed to load role");
      if (!permissionsResponse.ok) {
        throw new Error(permissionsBody.error || "Failed to load role permissions");
      }

      setRole(roleBody.role);
      setForm({
        name: roleBody.role.name,
        colorClass: roleBody.role.colorClass || defaultRoleFormValues().colorClass,
      });
      setPermissions(permissionsBody.permissions || {});
      setAllRoles(
        (rolesBody.roles || []).map((entry: RoleColorOwner) => ({
          key: entry.key,
          name: entry.name,
          colorClass: entry.colorClass,
        })),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push(`/login?callbackUrl=/admin/users/roles/${encodeURIComponent(roleKey)}`);
      return;
    }
    if (!canManage) return;
    void loadRoleData();
  }, [canManage, roleKey, router, session, status]);

  const saveOverview = async () => {
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/roles/${encodeURIComponent(roleKey)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, colorClass: form.colorClass }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to update role");
      setRole(body.role);
      setSuccess("Role updated.");
      await loadRoleData();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const archiveRole = async () => {
    if (!role || role.isSystem) return;
    const confirmed = window.confirm(
      `Archive "${role.name}"? It will disappear from filters and assignment dropdowns.`,
    );
    if (!confirmed) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/roles/${encodeURIComponent(roleKey)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to archive role");
      router.push(ROLES_LIST_HREF);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const restoreRole = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/roles/${encodeURIComponent(roleKey)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to restore role");
      await loadRoleData();
      setSuccess("Role restored.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (status === "loading" || isPermissionsLoading || (canManage && isLoading)) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-100 dark:bg-slate-900">
        <p className="text-slate-500">Loading role...</p>
      </div>
    );
  }

  if (!canManage) {
    return (
      <AdminRoleShell title="Edit role" backHref={ROLES_LIST_HREF}>
        <div className="pointer-events-none flex min-h-0 flex-1 select-none flex-col gap-4 blur-sm opacity-60">
          <div className="h-28 rounded-2xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60" />
          <div className="flex-1 rounded-2xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60" />
        </div>
        <AccessDeniedOverlay message="You do not have permission to manage role permissions." />
      </AdminRoleShell>
    );
  }

  if (!role) {
    return (
      <AdminRoleShell title="Role not found" backHref={ROLES_LIST_HREF}>
        <p className="text-slate-500">{error || "This role could not be loaded."}</p>
      </AdminRoleShell>
    );
  }

  return (
    <>
    <AdminRoleShell
      title={form.name || role.name}
      onBeforeNavigate={unsavedGuard.onBeforeNavigate}
      onBeforeLogout={() =>
        unsavedGuard.requestLeave(() => {
          void signOut({ callbackUrl: "/login" });
        })
      }
      badge={
        <div className="flex flex-wrap items-center gap-2">
          <RoleBadge name={form.name || role.name} colorClass={form.colorClass} />
          {!role.isActive ? (
            <span className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-500 dark:border-slate-600">
              Archived
            </span>
          ) : null}
          {role.isSystem ? (
            <span className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-500 dark:border-slate-600">
              System
            </span>
          ) : null}
        </div>
      }
      tabs={
        <RoleEditorTabs
          activeTab={activeTab}
          onSelect={(tab) =>
            selectTab(tab, tab === "permissions" ? searchParams?.get("page") : null)
          }
        />
      }
      actions={
        !role.isSystem && role.isActive ? (
          <button
            type="button"
            onClick={() => void archiveRole()}
            disabled={isSubmitting}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          >
            Archive role
          </button>
        ) : !role.isActive ? (
          <button
            type="button"
            onClick={() => void restoreRole()}
            disabled={isSubmitting}
            className="rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
          >
            Restore role
          </button>
        ) : role.isSystem ? (
          <span className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-500 dark:border-slate-600 dark:text-slate-400">
            System role
          </span>
        ) : null
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden sm:gap-3">
        {error ? (
          <div className="shrink-0 rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white">
            {error}
          </div>
        ) : null}
        {success ? (
          <div className="shrink-0 rounded-xl bg-green-600 px-4 py-3 text-sm font-semibold text-white">
            {success}
          </div>
        ) : null}

        {activeTab === "overview" ? (
          <RoleOverviewTab
            roleKey={role.key}
            role={role}
            form={form}
            onChange={setForm}
            permissions={permissions}
            allRoles={allRoles}
            isSubmitting={isSubmitting}
            onSave={() => void saveOverview()}
            permissionsHref={(pageId) => buildRoleUrl("permissions", pageId)}
          />
        ) : isFixedSystemRoleKey(role.key) ? (
          <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900 dark:border-amber-600/50 dark:bg-amber-900/20 dark:text-amber-200">
            {role.key === "SUPER_ADMIN"
              ? "Super Admin has fixed full-application permissions (excluding developer tools). Assign this role from the Users page."
              : "Developer has fixed developer-tool permissions. Only a Developer can assign or remove this role."}
          </div>
        ) : (
          <RolePermissionsEditor
            ref={unsavedGuard.targetRef}
            roleKey={role.key}
            showAudit
            initialPageId={initialPageId}
            primaryActionLabel="Save permissions"
          />
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
