"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  isPermissionToggleLocked,
  isRoleLockedPermission,
  type PermissionHierarchyGroup,
  type PermissionKey,
} from "@/lib/permissionCatalog";
import {
  countAllowedInSection,
  editableKeysInSections,
  initialJobOverridesFromResponse,
  jobEditableSectionsFromHierarchy,
  resetAllSectionsToDefaults,
  resetSectionToDefaults,
  allowFullSection,
  turnSectionOff,
  resolveEffectiveJobPermissions,
  setJobOverrideWithImplications,
  type OverrideState,
} from "@/lib/jobPermissionEditorUtils";
import { flattenNodes } from "@/lib/permissionEditorUtils";
import UserPermissionDrilldown from "@/components/roles/UserPermissionDrilldown";

type PermissionsResponse = {
  user: { email: string; name: string | null; role: string };
  basePermissions: Partial<Record<PermissionKey, boolean>>;
  overrides: Partial<Record<PermissionKey, "ALLOW" | "DENY">>;
};

type JobAccessOverridesModalProps = {
  jobNumber: string;
  listNumber: string;
  userEmail: string;
  userName?: string | null;
  onClose: () => void;
  onSaved?: () => void;
};

export default function JobAccessOverridesModal({
  jobNumber,
  listNumber,
  userEmail,
  userName,
  onClose,
  onSaved,
}: JobAccessOverridesModalProps) {
  const sections = useMemo(() => jobEditableSectionsFromHierarchy(), []);
  const [data, setData] = useState<PermissionsResponse | null>(null);
  const [overrides, setOverrides] = useState<Partial<Record<PermissionKey, OverrideState>>>({});
  const [activeSectionId, setActiveSectionId] = useState<string>(
    sections[0]?.id ?? "job.puller.view",
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;

  const activeSection =
    sections.find((section) => section.id === activeSectionId) ?? sections[0] ?? null;

  const roleTemplate = useMemo(() => {
    if (!data) return {} as Record<PermissionKey, boolean>;
    return data.basePermissions as Record<PermissionKey, boolean>;
  }, [data]);

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch(
        `/api/jobs/${encodeURIComponent(jobNumber)}/access/permissions?userEmail=${encodeURIComponent(userEmail)}&listNumber=${encodeURIComponent(listNumber)}`,
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || "Failed to load permissions");
      }
      setData(body);
      setOverrides(initialJobOverridesFromResponse(body.overrides, sections));
      setIsDirty(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [jobNumber, listNumber, sections, userEmail]);

  useEffect(() => {
    void load();
  }, [load]);

  const effectivePermissions = useMemo(() => {
    if (!data) return {} as Record<PermissionKey, boolean>;
    return resolveEffectiveJobPermissions({
      basePermissions: data.basePermissions,
      overrides,
    });
  }, [data, overrides]);

  const allowedCount = useMemo(
    () =>
      sections.reduce(
        (total, section) => total + countAllowedInSection(section, effectivePermissions),
        0,
      ),
    [sections, effectivePermissions],
  );

  const editableKeyCount = useMemo(() => editableKeysInSections(sections).length, [sections]);

  const markDirty = () => setIsDirty(true);

  const setOverride = (key: PermissionKey, state: OverrideState) => {
    if (isRoleLockedPermission(key)) return;
    if (isPermissionToggleLocked(key, effectivePermissions)) return;
    markDirty();
    setOverrides((current) => setJobOverrideWithImplications(current, key, state));
  };

  const setSectionState = (section: PermissionHierarchyGroup, state: OverrideState) => {
    markDirty();
    setOverrides((current) => {
      if (state === "DEFAULT") return resetSectionToDefaults(current, section);
      if (state === "DENY") return turnSectionOff(current, section);
      return allowFullSection(current, section);
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
        }

        const editableKeys = new Set(editableKeysInSections(sections));
        const payloadOverrides = Object.fromEntries(
          Object.entries(overridesRef.current).filter(([key]) =>
            editableKeys.has(key as PermissionKey),
          ),
        );

        const response = await fetch(
          `/api/jobs/${encodeURIComponent(jobNumber)}/access/permissions`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userEmail, listNumber, overrides: payloadOverrides }),
          },
        );
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error || "Failed to save permission overrides");
        }

        setData(body);
        setOverrides(initialJobOverridesFromResponse(body.overrides, sections));
        setIsDirty(false);
        onSaved?.();

        if (silent) {
          setAutoSaveStatus("saved");
          window.setTimeout(() => setAutoSaveStatus("idle"), 1500);
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
    [jobNumber, listNumber, onSaved, sections, userEmail],
  );

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
              Permissions for this job
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {userName || userEmail} — Job #{jobNumber}
              {listNumber !== "1" ? ` (List ${listNumber})` : ""}
              {data ? ` — ${data.user.role}` : ""}
            </p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              Changes apply only to this job. &quot;Default&quot; follows the user&apos;s normal role
              permissions.
            </p>
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
              <div className="flex flex-wrap items-center gap-2">
                {sections.map((section) => {
                  const allowed = countAllowedInSection(section, effectivePermissions);
                  const total = flattenNodes(section.nodes).filter(
                    (node) => !isRoleLockedPermission(node.key),
                  ).length;
                  const active = activeSectionId === section.id;
                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => setActiveSectionId(section.id)}
                      className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                        active
                          ? "bg-blue-600 text-white shadow-lg"
                          : "border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700/50 dark:text-slate-200 dark:hover:bg-slate-700/70"
                      }`}
                    >
                      {section.label}
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
            </div>

            {error ? (
              <div className="mx-5 mt-4 rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white">
                {error}
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {activeSection ? (
                <>
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                        {activeSection.label}
                      </h3>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {activeSection.help}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-slate-400 dark:text-slate-500">
                        {allowedCount}/{editableKeyCount} permissions allowed on this job
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setSectionState(activeSection, "DEFAULT")}
                        className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200"
                      >
                        Reset to defaults
                      </button>
                      <button
                        type="button"
                        onClick={() => setSectionState(activeSection, "DENY")}
                        className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                      >
                        Turn section off
                      </button>
                      <button
                        type="button"
                        onClick={() => setSectionState(activeSection, "ALLOW")}
                        className="rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
                      >
                        Allow full section
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          markDirty();
                          setOverrides((current) => resetAllSectionsToDefaults(current, sections));
                        }}
                        className="rounded-xl border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700/50 dark:text-slate-200"
                      >
                        Reset all
                      </button>
                    </div>
                  </div>

                  <UserPermissionDrilldown
                    key={activeSection.id}
                    group={activeSection}
                    template={roleTemplate}
                    overrides={overrides}
                    effectivePermissions={effectivePermissions}
                    setOverride={setOverride}
                    defaultStateSource="role"
                  />
                </>
              ) : null}
            </div>

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
                Close
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
