"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Lock } from "lucide-react";
import {
  getPermissionLockReason,
  getPermissionRequirements,
  isPermissionToggleLocked,
  type PermissionHierarchyGroup,
  type PermissionKey,
  type PermissionNode,
} from "@/lib/permissionCatalog";
import {
  buildOrgTree,
  countAllowedInSubtree,
  isDisabledByParent,
  partitionChildren,
  resolvePath,
} from "@/lib/permissionDrilldownTree";

function isToggleLocked(
  key: PermissionKey,
  permissions: Partial<Record<PermissionKey, boolean>>,
): boolean {
  return isPermissionToggleLocked(key, permissions);
}

function StatePill({ allowed }: { allowed: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-bold ${
        allowed
          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
          : "bg-slate-100 text-slate-600 dark:bg-slate-700/70 dark:text-slate-300"
      }`}
    >
      {allowed ? "On" : "Off"}
    </span>
  );
}

function LockedPill({ reason }: { reason?: string | null }) {
  return (
    <span
      title={reason ?? "This permission is locked."}
      className="flex cursor-help items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
    >
      <Lock className="h-3 w-3" aria-hidden="true" />
      Locked
    </span>
  );
}

function DangerPill() {
  return (
    <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700 dark:bg-red-900/30 dark:text-red-300">
      High impact
    </span>
  );
}

function PermissionSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-8 w-14 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-green-500" : "bg-slate-300 dark:bg-slate-600"
      }`}
    >
      <span
        className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition ${
          checked ? "left-7" : "left-1"
        }`}
      />
    </button>
  );
}

function ChildToggleRow({
  node,
  permissions,
  setPermission,
}: {
  node: PermissionNode;
  permissions: Partial<Record<PermissionKey, boolean>>;
  setPermission: (key: PermissionKey, allowed: boolean) => void;
}) {
  const savedAllowed = permissions[node.key] === true;
  const disabledByParent = isDisabledByParent(node.key, permissions);
  const toggleLocked = isToggleLocked(node.key, permissions);
  const effectiveAllowed = (savedAllowed || toggleLocked) && !disabledByParent;
  const lockReason =
    toggleLocked || disabledByParent ? getPermissionLockReason(node.key, permissions) : null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 bg-white px-4 py-3 dark:bg-slate-800/40">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-slate-900 dark:text-white">{node.label}</p>
          {node.dangerLevel === "high" ? <DangerPill /> : null}
          {toggleLocked || disabledByParent ? (
            <LockedPill reason={lockReason} />
          ) : (
            <StatePill allowed={effectiveAllowed} />
          )}
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{node.help}</p>
      </div>
      <PermissionSwitch
        checked={effectiveAllowed}
        disabled={disabledByParent || toggleLocked}
        onChange={() => setPermission(node.key, !savedAllowed)}
      />
    </div>
  );
}

function PermissionFocusCard({
  node,
  permissions,
  setPermission,
}: {
  node: PermissionNode;
  permissions: Partial<Record<PermissionKey, boolean>>;
  setPermission: (key: PermissionKey, allowed: boolean) => void;
}) {
  const allowed = permissions[node.key] === true;
  const disabledByParent = isDisabledByParent(node.key, permissions);
  const toggleLocked = isToggleLocked(node.key, permissions);
  const effectiveAllowed = (allowed || toggleLocked) && !disabledByParent;
  const lockReason =
    toggleLocked || disabledByParent ? getPermissionLockReason(node.key, permissions) : null;

  const isJobsView = node.key === "jobs.view";
  const contractOn = permissions["jobs.view_contract_jobs"] === true;
  const serviceOn = permissions["jobs.view_service_jobs"] === true;
  const selected =
    contractOn && serviceOn ? "ALL" : serviceOn ? "SERVICE" : contractOn ? "CONTRACT" : null;

  const setVisibility = (value: "ALL" | "CONTRACT" | "SERVICE") => {
    setPermission("jobs.view", true);
    setPermission("jobs.view_contract_jobs", value === "ALL" || value === "CONTRACT");
    setPermission("jobs.view_service_jobs", value === "ALL" || value === "SERVICE");
  };

  // Self-heal an already-on state that has neither job type selected (e.g.
  // saved before this default existed) by defaulting to full visibility.
  useEffect(() => {
    if (isJobsView && allowed && !contractOn && !serviceOn) {
      setVisibility("ALL");
    }
  }, [isJobsView, allowed, contractOn, serviceOn]);

  const toggleAllowed = () => {
    const turningOn = !allowed;
    setPermission(node.key, turningOn);
    if (isJobsView && turningOn && !contractOn && !serviceOn) {
      setVisibility("ALL");
    }
  };

  return (
    <section
      className={`overflow-hidden rounded-2xl border p-5 shadow-sm ${
        disabledByParent
          ? "border-slate-200/70 bg-slate-50/70 dark:border-slate-700/30 dark:bg-slate-900/30"
          : "border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">{node.label}</h3>
            {node.dangerLevel === "high" ? <DangerPill /> : null}
            {toggleLocked || disabledByParent ? (
              <LockedPill reason={lockReason} />
            ) : (
              <StatePill allowed={effectiveAllowed} />
            )}
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{node.help}</p>
        </div>
        <PermissionSwitch checked={effectiveAllowed} disabled={disabledByParent || toggleLocked} onChange={toggleAllowed} />
      </div>

      {isJobsView && allowed && !disabledByParent ? (
        <div className="mt-4 grid overflow-hidden rounded-xl border border-slate-300 bg-slate-100 text-sm font-bold dark:border-slate-600 dark:bg-slate-900/40 sm:grid-cols-3">
          {(["ALL", "CONTRACT", "SERVICE"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setVisibility(value)}
              className={`px-5 py-3 transition ${
                selected === value
                  ? "bg-blue-600 text-white shadow-inner"
                  : "text-slate-700 hover:bg-white dark:text-slate-200 dark:hover:bg-slate-800"
              }`}
            >
              {value === "ALL" ? "All" : value === "CONTRACT" ? "Contract" : "Service"}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default function PermissionDrilldown({
  group,
  permissions,
  setPermission,
}: {
  group: PermissionHierarchyGroup;
  permissions: Partial<Record<PermissionKey, boolean>>;
  setPermission: (key: PermissionKey, allowed: boolean) => void;
}) {
  const root = useMemo(() => buildOrgTree(group.nodes), [group]);
  const [path, setPath] = useState<PermissionKey[]>(() => [root.node.key]);

  const trail = useMemo(() => resolvePath(root, path), [root, path]);
  const current = trail[trail.length - 1] ?? root;
  const { leaves, sections } = partitionChildren(current.kids);

  const zoomTo = (key: PermissionKey) => setPath((prev) => [...prev, key]);
  const zoomToIndex = (index: number) => setPath((prev) => prev.slice(0, index + 1));

  return (
    <div className="space-y-4">
      {trail.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
          {trail.map((n, index) => (
            <span key={n.node.key} className="flex items-center gap-1">
              {index > 0 ? (
                <ChevronRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              ) : null}
              <button
                type="button"
                onClick={() => zoomToIndex(index)}
                disabled={index === trail.length - 1}
                className={
                  index === trail.length - 1
                    ? "cursor-default text-slate-900 dark:text-white"
                    : "hover:text-blue-600 dark:hover:text-blue-400"
                }
              >
                {n.node.label}
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div key={current.node.key} className="permission-zoom-panel space-y-4">
        <PermissionFocusCard node={current.node} permissions={permissions} setPermission={setPermission} />

        {leaves.length > 0 ? (
          <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-700/50 dark:border-slate-700/50">
            {leaves.map((leaf) => (
              <ChildToggleRow
                key={leaf.node.key}
                node={leaf.node}
                permissions={permissions}
                setPermission={setPermission}
              />
            ))}
          </div>
        ) : null}

        {sections.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {sections.map((section) => {
              const sectionAllowed = permissions[section.node.key] === true;
              const { allowed, total } = countAllowedInSubtree(
                section,
                permissions,
                (key, perms) => {
                  if (isPermissionToggleLocked(key, perms)) return true;
                  if (perms[key] !== true) return false;
                  if (isDisabledByParent(key, perms)) return false;
                  return getPermissionRequirements(key).every((req) => perms[req] === true);
                },
              );
              return (
                <button
                  key={section.node.key}
                  type="button"
                  onClick={() => zoomTo(section.node.key)}
                  className="flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700/50 dark:text-slate-200 dark:hover:bg-slate-700/70"
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      sectionAllowed ? "bg-green-500" : "bg-slate-400 dark:bg-slate-500"
                    }`}
                    aria-hidden="true"
                  />
                  {section.node.label}
                  <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {allowed}/{total}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
