"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  AUTO_ADD_JOB_ACCESS_KEY,
  PERMISSION_HIERARCHY,
  applyImpliedPermissions,
  applyRoleLockedPermissions,
  canUseAutoAddJobAccess,
  getPermissionRequirements,
  isPermissionToggleLocked,
  isRoleLockedPermission,
  isRolePermissionGroupHidden,
  type PermissionHierarchyGroup,
  type PermissionKey,
  type PermissionNode,
} from "@/lib/permissionCatalog";
import { isJobPreorderEnabled } from "@/lib/featureFlags";
import { formatDateInAppTimeZone } from "@/lib/timezone";
import PermissionDrilldown from "@/components/roles/PermissionDrilldown";
import type { UnsavedChangesHandle } from "@/lib/hooks/useUnsavedChangesGuard";

type RoleRecord = {
  key: string;
  name: string;
  description: string | null;
  colorClass: string | null;
  isSystem: boolean;
  isActive: boolean;
};

type RolePermissionResponse = {
  role: RoleRecord;
  permissions: Record<PermissionKey, boolean>;
  auditLogs?: Array<{
    id: string;
    action: string;
    before: unknown;
    after: unknown;
    createdAt: string;
    actor: { email: string; name: string | null } | null;
  }>;
};

type RolePermissionsEditorProps = {
  roleKey: string;
  showAudit?: boolean;
  primaryActionLabel?: string;
  initialPageId?: string | null;
  onSaved?: () => void;
};

function flattenNodes(nodes: readonly PermissionNode[]): PermissionNode[] {
  return nodes.flatMap((node) => [node, ...flattenNodes(node.children ?? [])]);
}

function filterHiddenFeatureNodes(nodes: readonly PermissionNode[]): PermissionNode[] {
  const preorderEnabled = isJobPreorderEnabled();
  return nodes
    .filter((node) => preorderEnabled || !node.key.startsWith("job.preorder."))
    .map((node) => ({
      ...node,
      children: node.children ? filterHiddenFeatureNodes(node.children) : undefined,
    }));
}

function rootKeys(group: PermissionHierarchyGroup): PermissionKey[] {
  return group.nodes.map((node) => node.key);
}

function isEffectivelyAllowed(
  key: PermissionKey,
  permissions: Partial<Record<PermissionKey, boolean>>,
) {
  if (isPermissionToggleLocked(key, permissions)) return true;
  if (permissions[key] !== true) return false;
  if (key === AUTO_ADD_JOB_ACCESS_KEY && !canUseAutoAddJobAccess(permissions)) {
    return false;
  }
  return getPermissionRequirements(key).every((requiredKey) => permissions[requiredKey] === true);
}

function countAllowedInGroup(
  group: PermissionHierarchyGroup,
  permissions: Partial<Record<PermissionKey, boolean>>,
) {
  return flattenNodes(group.nodes).filter((node) => isEffectivelyAllowed(node.key, permissions)).length;
}

const RolePermissionsEditor = forwardRef<UnsavedChangesHandle, RolePermissionsEditorProps>(
  function RolePermissionsEditor(
    { roleKey, showAudit = false, primaryActionLabel = "Save permissions", initialPageId, onSaved },
    ref,
  ) {
  const [data, setData] = useState<RolePermissionResponse | null>(null);
  const [permissions, setPermissions] = useState<Partial<Record<PermissionKey, boolean>>>({});
  const [activePageId, setActivePageId] = useState<string>("jobs");
  const [mainTab, setMainTab] = useState<"permissions" | "audit">("permissions");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const permissionsRef = useRef(permissions);
  permissionsRef.current = permissions;

  const editableGroups = useMemo(
    () =>
      PERMISSION_HIERARCHY
        .filter((group) => !isRolePermissionGroupHidden(group.id))
        .map((group) => ({
          ...group,
          nodes: filterHiddenFeatureNodes(group.nodes),
        }))
        .filter((group) => group.nodes.length > 0),
    [],
  );

  const activeGroup = editableGroups.find((group) => group.id === activePageId) ?? editableGroups[0];

  const loadPermissions = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch(`/api/roles/${encodeURIComponent(roleKey)}/permissions`, {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || "Failed to load role permissions");
      }
      setData(body);
      setPermissions(applyRoleLockedPermissions(body.permissions || {}));
      setIsDirty(false);
      const preferredPage =
        initialPageId && editableGroups.some((group) => group.id === initialPageId)
          ? initialPageId
          : editableGroups[0]?.id;
      if (preferredPage) setActivePageId(preferredPage);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadPermissions();
  }, [roleKey]);

  useEffect(() => {
    if (!initialPageId) return;
    if (editableGroups.some((group) => group.id === initialPageId)) {
      setActivePageId(initialPageId);
    }
  }, [initialPageId, editableGroups]);

  const allowedCount = useMemo(
    () =>
      editableGroups.reduce(
        (total, group) => total + countAllowedInGroup(group, permissions),
        0,
      ),
    [editableGroups, permissions],
  );

  const setPermission = (key: PermissionKey, allowed: boolean) => {
    if (isRoleLockedPermission(key)) return;
    setIsDirty(true);
    setPermissions((current) => {
      if (isPermissionToggleLocked(key, current)) return current;
      const next = { ...current, [key]: allowed };
      if (allowed) {
        for (const requiredKey of getPermissionRequirements(key)) {
          if (!isRoleLockedPermission(requiredKey)) next[requiredKey] = true;
        }
      } else if (key === "jobs.view") {
        // Clearing the master switch must also clear scope flags; otherwise
        // applyImpliedPermissions re-enables jobs.view from a lingering scope.
        next["jobs.view_contract_jobs"] = false;
        next["jobs.view_service_jobs"] = false;
      } else if (key === "orders.to_order.view") {
        next["orders.to_order.edit"] = false;
        next["orders.generate_send"] = false;
      }
      return applyImpliedPermissions(next as Record<PermissionKey, boolean>);
    });
  };

  const allowFullPage = (group: PermissionHierarchyGroup) => {
    setIsDirty(true);
    setPermissions((current) => {
      const next = { ...current };
      for (const key of flattenNodes(group.nodes).map((node) => node.key)) {
        if (!isRoleLockedPermission(key)) next[key] = true;
      }
      return applyImpliedPermissions(next as Record<PermissionKey, boolean>);
    });
  };

  const turnPageOff = (group: PermissionHierarchyGroup) => {
    setIsDirty(true);
    setPermissions((current) => {
      const next = { ...current };
      for (const key of rootKeys(group)) {
        if (!isRoleLockedPermission(key)) next[key] = false;
      }
      if (group.id === "jobs") {
        next["jobs.view_contract_jobs"] = false;
        next["jobs.view_service_jobs"] = false;
      }
      return applyImpliedPermissions(next as Record<PermissionKey, boolean>);
    });
  };

  // Shared by the manual "Save permissions" button and the silent
  // autosave/leave-guard paths. Silent saves skip the success banner and
  // the post-save refetch so toggling permissions never feels like it
  // reloads anything.
  const performSave = async ({ silent = false }: { silent?: boolean } = {}): Promise<boolean> => {
    try {
      setIsSaving(true);
      if (silent) {
        setAutoSaveStatus("saving");
      } else {
        setError(null);
        setSuccess(null);
      }
      const response = await fetch(`/api/roles/${encodeURIComponent(roleKey)}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions: permissionsRef.current }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || "Failed to save role permissions");
      }
      setIsDirty(false);
      if (silent) {
        setAutoSaveStatus("saved");
        window.setTimeout(() => setAutoSaveStatus("idle"), 1500);
      } else {
        setSuccess("Permissions saved.");
        onSaved?.();
        await loadPermissions();
      }
      return true;
    } catch (err) {
      setError((err as Error).message);
      setAutoSaveStatus("idle");
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const save = () => performSave();

  // Auto-save 2s after the last change, so a logout/navigation attempt that
  // happens to land outside that window already has nothing left to save.
  useEffect(() => {
    if (!isDirty) return;
    const timer = window.setTimeout(() => {
      void performSave({ silent: true });
    }, 2000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, permissions]);

  // Warn on tab close/refresh while a change hasn't been auto-saved yet.
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  useImperativeHandle(ref, () => ({
    hasUnsavedChanges: () => isDirtyRef.current,
    saveNow: () => performSave({ silent: true }),
  }));

  if (isLoading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-2xl border border-slate-200 bg-white p-12 text-center text-slate-500 shadow-sm dark:border-slate-700/50 dark:bg-slate-800/60">
        Loading permissions...
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-2xl border border-red-300 bg-red-50 p-8 text-center text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
        {error}
      </div>
    );
  }

  if (!data || !activeGroup) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700/50 dark:bg-slate-800/60">
      <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700/50">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {editableGroups.map((group) => {
              const allowed = countAllowedInGroup(group, permissions);
              const total = flattenNodes(group.nodes).filter((node) => !isRoleLockedPermission(node.key)).length;
              const active = mainTab === "permissions" && activePageId === group.id;
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => {
                    setMainTab("permissions");
                    setActivePageId(group.id);
                  }}
                  className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                    active
                      ? "bg-blue-600 text-white shadow-lg"
                      : "border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700/50 dark:text-slate-200 dark:hover:bg-slate-700/70"
                  }`}
                >
                  {group.label}
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                      active ? "bg-blue-500 text-white" : "bg-white/80 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    }`}
                  >
                    {allowed}/{total}
                  </span>
                </button>
              );
            })}
          </div>
          {showAudit ? (
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => setMainTab("permissions")}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  mainTab === "permissions"
                    ? "bg-blue-600 text-white shadow-md"
                    : "bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200"
                }`}
              >
                Permissions
              </button>
              <button
                type="button"
                onClick={() => setMainTab("audit")}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  mainTab === "audit"
                    ? "bg-blue-600 text-white shadow-md"
                    : "bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200"
                }`}
              >
                Audit
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="mx-5 mt-4 rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="mx-5 mt-4 rounded-xl bg-green-600 px-4 py-3 text-sm font-semibold text-white">
          {success}
        </div>
      ) : null}

      {mainTab === "audit" && showAudit ? (
        <div className="space-y-3 p-5">
          {(data.auditLogs || []).length === 0 ? (
            <p className="text-sm text-slate-500">No role audit history yet.</p>
          ) : (
            data.auditLogs?.map((log) => (
              <div
                key={log.id}
                className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700/50 dark:bg-slate-900/30"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900 dark:text-white">{log.action}</span>
                  <span className="text-xs text-slate-500">
                    {formatDateInAppTimeZone(log.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{log.actor?.email || "System"}</p>
              </div>
            ))
          )}
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                  {activeGroup.label}
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {activeGroup.help}
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-400 dark:text-slate-500">
                  {allowedCount} active permissions allowed across all pages
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => turnPageOff(activeGroup)}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                >
                  Turn page off
                </button>
                <button
                  type="button"
                  onClick={() => allowFullPage(activeGroup)}
                  className="rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
                >
                  Allow full page
                </button>
              </div>
            </div>

            <PermissionDrilldown
              key={activeGroup.id}
              group={activeGroup}
              permissions={permissions}
              setPermission={setPermission}
            />
          </div>
        </>
      )}

      <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-4 dark:border-slate-700/50">
        <span className="text-xs font-semibold text-slate-400 dark:text-slate-500">
          {autoSaveStatus === "saving"
            ? "Saving…"
            : autoSaveStatus === "saved"
              ? "Saved"
              : isDirty
                ? "Unsaved changes — auto-saving shortly"
                : null}
        </span>
        <button
          type="button"
          onClick={() => void save()}
          disabled={isSaving || mainTab === "audit"}
          className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {isSaving ? "Saving..." : primaryActionLabel}
        </button>
      </div>
    </div>
  );
  },
);

export default RolePermissionsEditor;
