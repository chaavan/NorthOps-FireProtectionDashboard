"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  isDeveloperOnlyPermission,
  isPermissionToggleLocked,
  isRoleLockedPermission,
  type PermissionHierarchyGroup,
  type PermissionKey,
} from "@/lib/permissionCatalog";
import { isFixedSystemRoleKey, SYSTEM_ROLE_KEYS } from "@/lib/systemRoleClient";
import {
  allowFullPageOverrides,
  countAllowedInGroup,
  editableGroupsFromHierarchy,
  flattenNodes,
  initialOverridesFromResponse,
  resetPageToDefaults,
  resolveEffectiveUserPermissions,
  setOverrideWithImplications,
  turnPageOffOverrides,
  type OverrideState,
} from "@/lib/permissionEditorUtils";
import { formatDateInAppTimeZone } from "@/lib/timezone";
import UserPermissionDrilldown from "@/components/roles/UserPermissionDrilldown";

type PermissionAuditLog = {
  id: string;
  action: string;
  permissionKey: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
  actor: { id: string; email: string; name: string | null } | null;
};

type PermissionResponse = {
  user: {
    id: string;
    email: string;
    name: string | null;
    role: string;
    isDeveloper: boolean;
    isSuperAdmin: boolean;
  };
  permissions: Record<PermissionKey, boolean>;
  template: Record<PermissionKey, boolean>;
  overrides: Partial<Record<PermissionKey, "ALLOW" | "DENY">>;
  auditLogs?: PermissionAuditLog[];
};

type UserPermissionsModalProps = {
  userId: string;
  onClose: () => void;
  onSaved?: () => void;
};

function summarizeJson(value: unknown) {
  if (!value || typeof value !== "object") return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

export default function UserPermissionsModal({
  userId,
  onClose,
  onSaved,
}: UserPermissionsModalProps) {
  const [data, setData] = useState<PermissionResponse | null>(null);
  const [overrides, setOverrides] = useState<Partial<Record<PermissionKey, OverrideState>>>({});
  const [mainTab, setMainTab] = useState<"permissions" | "audit">("permissions");
  const [activePageId, setActivePageId] = useState<string>("jobs");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;

  const editableGroups = useMemo(() => editableGroupsFromHierarchy(), []);
  const activeGroup = editableGroups.find((group) => group.id === activePageId) ?? editableGroups[0];

  const loadPermissions = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch(`/api/users/${userId}/permissions`, {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || "Failed to load permissions");
      }
      setData(body);
      setOverrides(initialOverridesFromResponse(body.overrides));
      setIsDirty(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadPermissions();
  }, [loadPermissions]);

  const effectivePermissions = useMemo(() => {
    if (!data) return {} as Record<PermissionKey, boolean>;
    return resolveEffectiveUserPermissions({
      template: data.template,
      overrides,
      isSuperAdmin: data.user.isSuperAdmin,
      isDeveloper: data.user.isDeveloper,
    });
  }, [data, overrides]);

  const allowedCount = useMemo(
    () =>
      editableGroups.reduce(
        (total, group) => total + countAllowedInGroup(group, effectivePermissions),
        0,
      ),
    [editableGroups, effectivePermissions],
  );

  const markDirty = () => setIsDirty(true);

  const setOverride = (key: PermissionKey, state: OverrideState) => {
    if (isRoleLockedPermission(key)) return;
    if (isPermissionToggleLocked(key, effectivePermissions)) return;
    markDirty();
    setOverrides((current) => setOverrideWithImplications(current, key, state));
  };

  const setGroupState = (group: PermissionHierarchyGroup, state: OverrideState) => {
    markDirty();
    setOverrides((current) => {
      if (state === "DEFAULT") return resetPageToDefaults(current, group);
      if (state === "DENY") return turnPageOffOverrides(current, group);
      return allowFullPageOverrides(current, group);
    });
  };

  const performSave = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}): Promise<boolean> => {
      try {
        setIsSaving(true);
        if (silent) {
          setAutoSaveStatus("saving");
        } else {
          setError(null);
          setSuccess(null);
        }

        const response = await fetch(`/api/users/${userId}/permissions`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            overrides: Object.fromEntries(
              Object.entries(overridesRef.current).filter(
                ([key]) => !isDeveloperOnlyPermission(key as PermissionKey),
              ),
            ),
          }),
        });
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error || "Failed to save permissions");
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
    },
    [loadPermissions, onSaved, userId],
  );

  const save = () => performSave();

  const handleClose = () => {
    if (isDirtyRef.current) {
      const confirmed = window.confirm(
        "You have unsaved permission changes. Close without saving?",
      );
      if (!confirmed) return;
    }
    onClose();
  };

  useEffect(() => {
    if (!isDirty) return;
    const timer = window.setTimeout(() => {
      void performSave({ silent: true });
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [isDirty, overrides, performSave]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const isFixedSystemRole = data ? isFixedSystemRoleKey(data.user.role) : false;

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
        <div className="rounded-2xl bg-white p-8 text-center text-slate-500 shadow-2xl dark:bg-slate-800">
          Loading permissions...
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700/50 dark:bg-slate-800">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700/50">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
              User Permissions
            </h2>
            {data ? (
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {data.user.name || data.user.email} - {data.user.role}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700/60"
          >
            Close
          </button>
        </div>

        {error && !data ? (
          <div className="p-8 text-center text-red-600">{error}</div>
        ) : data ? (
          <>
            <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700/50">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {editableGroups.map((group) => {
                    const allowed = countAllowedInGroup(group, effectivePermissions);
                    const total = flattenNodes(group.nodes).filter(
                      (node) => !isRoleLockedPermission(node.key),
                    ).length;
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
                            active
                              ? "bg-blue-500 text-white"
                              : "bg-white/80 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                          }`}
                        >
                          {allowed}/{total}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
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
              </div>
            </div>

            {isFixedSystemRole ? (
              <div className="mx-5 mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-600/50 dark:bg-amber-900/20 dark:text-amber-200">
                {data.user.role === SYSTEM_ROLE_KEYS.SUPER_ADMIN
                  ? "Super Admin permissions are fixed. Use Edit Role to change this user's system role."
                  : "Developer permissions are fixed. Only a Developer can assign or remove the Developer role."}
              </div>
            ) : null}

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

            {mainTab === "audit" ? (
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
                {(data.auditLogs || []).length === 0 ? (
                  <p className="text-sm text-slate-500">No permission changes recorded yet.</p>
                ) : (
                  (data.auditLogs || []).map((log) => (
                    <div
                      key={log.id}
                      className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700/50 dark:bg-slate-900/30"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900 dark:text-white">
                          {log.permissionKey || log.action}
                        </span>
                        <span className="text-xs text-slate-500">
                          {formatDateInAppTimeZone(log.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {log.actor?.email || "System"}
                      </p>
                      <p className="mt-2 break-all font-mono text-xs text-slate-500">
                        {summarizeJson(log.before)} {"->"} {summarizeJson(log.after)}
                      </p>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                {isFixedSystemRole ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Permission overrides are not available for system roles.
                  </p>
                ) : activeGroup ? (
                  <>
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
                          onClick={() => setGroupState(activeGroup, "DEFAULT")}
                          className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200"
                        >
                          Reset to defaults
                        </button>
                        <button
                          type="button"
                          onClick={() => setGroupState(activeGroup, "DENY")}
                          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                        >
                          Turn page off
                        </button>
                        <button
                          type="button"
                          onClick={() => setGroupState(activeGroup, "ALLOW")}
                          className="rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
                        >
                          Allow full page
                        </button>
                      </div>
                    </div>

                    <UserPermissionDrilldown
                      key={activeGroup.id}
                      group={activeGroup}
                      template={data.template}
                      overrides={overrides}
                      effectivePermissions={effectivePermissions}
                      setOverride={setOverride}
                    />
                  </>
                ) : null}
              </div>
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
                onClick={handleClose}
                disabled={isSaving}
                className="rounded-xl bg-slate-200 px-5 py-2.5 font-semibold text-slate-700 hover:bg-slate-300 disabled:opacity-60 dark:bg-slate-700/50 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={isSaving || mainTab === "audit" || isFixedSystemRole}
                className="rounded-xl bg-blue-600 px-5 py-2.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {isSaving ? "Saving..." : "Save Permissions"}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
