"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Lock } from "lucide-react";
import {
  AUTO_ADD_JOB_ACCESS_KEY,
  canUseAutoAddJobAccess,
  getPermissionLockReason,
  getPermissionRequirements,
  isPermissionToggleLocked,
  isRoleLockedPermission,
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
import {
  isEffectivelyAllowed,
  type OverrideState,
} from "@/lib/permissionEditorUtils";

function StatePill({
  label,
  tone,
  title,
}: {
  label: string;
  tone: "on" | "off" | "default" | "disabled";
  title?: string | null;
}) {
  const className =
    tone === "on"
      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
      : tone === "disabled"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
        : tone === "default"
          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
          : "bg-slate-100 text-slate-600 dark:bg-slate-700/70 dark:text-slate-300";
  return (
    <span
      title={title ?? undefined}
      className={`rounded-full px-2.5 py-1 text-xs font-bold ${tone === "disabled" ? "cursor-help" : ""} ${className}`}
    >
      {label}
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

function PermissionStateButtons({
  value,
  disabled,
  onChange,
}: {
  value: OverrideState;
  disabled?: boolean;
  onChange: (state: OverrideState) => void;
}) {
  return (
    <div className="grid min-w-[15rem] grid-cols-3 overflow-hidden rounded-lg border border-slate-200 text-xs font-semibold dark:border-slate-700">
      {(["DEFAULT", "ALLOW", "DENY"] as const).map((state) => (
        <button
          key={state}
          type="button"
          disabled={disabled}
          onClick={() => onChange(state)}
          className={`px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50 ${
            value === state
              ? state === "ALLOW"
                ? "bg-green-600 text-white"
                : state === "DENY"
                  ? "bg-red-600 text-white"
                  : "bg-blue-600 text-white"
              : "bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          }`}
        >
          {state === "DEFAULT" ? "Default" : state === "ALLOW" ? "Allowed" : "Denied"}
        </button>
      ))}
    </div>
  );
}

function useNodeControlState(
  node: PermissionNode,
  overrides: Partial<Record<PermissionKey, OverrideState>>,
  effectivePermissions: Record<PermissionKey, boolean>,
  template: Record<PermissionKey, boolean>,
  defaultStateSource: "role" | "template" = "template",
) {
  const state = overrides[node.key] ?? "DEFAULT";
  const effective = isEffectivelyAllowed(node.key, effectivePermissions);
  const toggleLocked = isPermissionToggleLocked(node.key, effectivePermissions);
  const disabledByParent =
    getPermissionRequirements(node.key).some(
      (requiredKey) => effectivePermissions[requiredKey] !== true,
    ) ||
    (node.key === AUTO_ADD_JOB_ACCESS_KEY && !canUseAutoAddJobAccess(effectivePermissions));
  const lockReason = getPermissionLockReason(node.key, effectivePermissions);
  const defaultSuffix = defaultStateSource === "role" ? " (from role)" : "";
  const defaultState = template[node.key]
    ? `Default on${defaultSuffix}`
    : `Default off${defaultSuffix}`;
  const controlDisabled =
    disabledByParent || isRoleLockedPermission(node.key) || toggleLocked;

  return {
    state,
    effective,
    toggleLocked,
    disabledByParent,
    lockReason,
    defaultState,
    controlDisabled,
  };
}

function UserPermissionFocusCard({
  node,
  overrides,
  effectivePermissions,
  template,
  setOverride,
  defaultStateSource = "template",
}: {
  node: PermissionNode;
  overrides: Partial<Record<PermissionKey, OverrideState>>;
  effectivePermissions: Record<PermissionKey, boolean>;
  template: Record<PermissionKey, boolean>;
  setOverride: (key: PermissionKey, state: OverrideState) => void;
  defaultStateSource?: "role" | "template";
}) {
  const {
    state,
    effective,
    toggleLocked,
    disabledByParent,
    lockReason,
    defaultState,
    controlDisabled,
  } = useNodeControlState(node, overrides, effectivePermissions, template, defaultStateSource);

  const isJobsView = node.key === "jobs.view";
  const contractOn = effectivePermissions["jobs.view_contract_jobs"] === true;
  const serviceOn = effectivePermissions["jobs.view_service_jobs"] === true;
  const selected =
    contractOn && serviceOn ? "ALL" : serviceOn ? "SERVICE" : contractOn ? "CONTRACT" : null;

  const setVisibility = (value: "ALL" | "CONTRACT" | "SERVICE") => {
    setOverride("jobs.view", "ALLOW");
    setOverride(
      "jobs.view_contract_jobs",
      value === "ALL" || value === "CONTRACT" ? "ALLOW" : "DENY",
    );
    setOverride(
      "jobs.view_service_jobs",
      value === "ALL" || value === "SERVICE" ? "ALLOW" : "DENY",
    );
  };

  useEffect(() => {
    if (isJobsView && effective && !contractOn && !serviceOn) {
      setVisibility("ALL");
    }
  }, [isJobsView, effective, contractOn, serviceOn]);

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
              <StatePill label={effective ? "On" : "Off"} tone={effective ? "on" : "off"} />
            )}
            {state === "DEFAULT" ? (
              <StatePill label={defaultState} tone="default" />
            ) : null}
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{node.help}</p>
        </div>
        <PermissionStateButtons
          value={state}
          disabled={controlDisabled}
          onChange={(nextState) => setOverride(node.key, nextState)}
        />
      </div>

      {isJobsView && effective && !disabledByParent ? (
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

function UserPermissionChildRow({
  node,
  overrides,
  effectivePermissions,
  template,
  setOverride,
  defaultStateSource = "template",
}: {
  node: PermissionNode;
  overrides: Partial<Record<PermissionKey, OverrideState>>;
  effectivePermissions: Record<PermissionKey, boolean>;
  template: Record<PermissionKey, boolean>;
  setOverride: (key: PermissionKey, state: OverrideState) => void;
  defaultStateSource?: "role" | "template";
}) {
  const {
    state,
    effective,
    toggleLocked,
    disabledByParent,
    lockReason,
    defaultState,
    controlDisabled,
  } = useNodeControlState(node, overrides, effectivePermissions, template, defaultStateSource);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 bg-white px-4 py-3 dark:bg-slate-800/40">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-slate-900 dark:text-white">{node.label}</p>
          {node.dangerLevel === "high" ? <DangerPill /> : null}
          {toggleLocked || disabledByParent ? (
            <LockedPill reason={lockReason} />
          ) : (
            <StatePill label={effective ? "On" : "Off"} tone={effective ? "on" : "off"} />
          )}
          {state === "DEFAULT" ? (
            <StatePill label={defaultState} tone="default" />
          ) : null}
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{node.help}</p>
      </div>
      <PermissionStateButtons
        value={state}
        disabled={controlDisabled}
        onChange={(nextState) => setOverride(node.key, nextState)}
      />
    </div>
  );
}

export default function UserPermissionDrilldown({
  group,
  template,
  overrides,
  effectivePermissions,
  setOverride,
  defaultStateSource = "template",
}: {
  group: PermissionHierarchyGroup;
  template: Record<PermissionKey, boolean>;
  overrides: Partial<Record<PermissionKey, OverrideState>>;
  effectivePermissions: Record<PermissionKey, boolean>;
  setOverride: (key: PermissionKey, state: OverrideState) => void;
  defaultStateSource?: "role" | "template";
}) {
  const root = useMemo(() => buildOrgTree(group.nodes), [group]);
  const [path, setPath] = useState<PermissionKey[]>(() => [root.node.key]);

  const trail = useMemo(() => resolvePath(root, path), [root, path]);
  const current = trail[trail.length - 1] ?? root;
  const { leaves, sections } = partitionChildren(current.kids);

  const zoomTo = (key: PermissionKey) => setPath((prev) => [...prev, key]);
  const zoomToIndex = (index: number) => setPath((prev) => prev.slice(0, index + 1));

  const isAllowed = (key: PermissionKey, permissions: Partial<Record<PermissionKey, boolean>>) =>
    isEffectivelyAllowed(key, permissions as Record<PermissionKey, boolean>);

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
        <UserPermissionFocusCard
          node={current.node}
          overrides={overrides}
          effectivePermissions={effectivePermissions}
          template={template}
          setOverride={setOverride}
          defaultStateSource={defaultStateSource}
        />

        {leaves.length > 0 ? (
          <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-700/50 dark:border-slate-700/50">
            {leaves.map((leaf) => (
              <UserPermissionChildRow
                key={leaf.node.key}
                node={leaf.node}
                overrides={overrides}
                effectivePermissions={effectivePermissions}
                template={template}
                setOverride={setOverride}
                defaultStateSource={defaultStateSource}
              />
            ))}
          </div>
        ) : null}

        {sections.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {sections.map((section) => {
              const sectionAllowed = isAllowed(section.node.key, effectivePermissions);
              const { allowed, total } = countAllowedInSubtree(
                section,
                effectivePermissions,
                isAllowed,
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
