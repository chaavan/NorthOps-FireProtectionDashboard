import {
  AUTO_ADD_JOB_ACCESS_KEY,
  PERMISSION_HIERARCHY,
  ALL_PERMISSION_KEYS,
  getHierarchyGroupKeys,
  getPermissionRequirements,
  isRoleLockedPermission,
  type PermissionHierarchyGroup,
  type PermissionKey,
  type PermissionNode,
} from "@/lib/permissionCatalog";
import { isJobPreorderEnabled } from "@/lib/featureFlags";
import {
  allowFullPageOverrides,
  countAllowedInGroup,
  filterHiddenFeatureNodes,
  flattenNodes,
  overridesToAllowDeny,
  resetPageToDefaults,
  rootKeys,
  turnPageOffOverrides,
  type OverrideState,
} from "@/lib/permissionEditorUtils";

export type { OverrideState };

/** Keys writable from the job Access tab (excludes global job visibility). */
export const JOB_OVERRIDABLE_KEYS = new Set<PermissionKey>(
  getHierarchyGroupKeys("jobs").filter(
    (key) =>
      key !== "jobs.view" &&
      key !== "jobs.view_contract_jobs" &&
      key !== "jobs.view_service_jobs" &&
      key !== AUTO_ADD_JOB_ACCESS_KEY,
  ),
);

export function isJobOverridableKey(key: PermissionKey): boolean {
  return JOB_OVERRIDABLE_KEYS.has(key);
}

/**
 * Merges job-scoped overrides on top of global effective permissions.
 * Mirrors server-side hasPermission job-context checks.
 */
export function mergeJobScopedPermissions(
  basePermissions: Record<PermissionKey, boolean>,
  overrides: Partial<Record<PermissionKey, "ALLOW" | "DENY">>,
): Record<PermissionKey, boolean> {
  const scoped = (key: PermissionKey): boolean =>
    JOB_OVERRIDABLE_KEYS.has(key) && overrides[key]
      ? overrides[key] === "ALLOW"
      : basePermissions[key] === true;

  const merged: Record<PermissionKey, boolean> = { ...basePermissions };
  for (const key of ALL_PERMISSION_KEYS) {
    merged[key] = scoped(key) && getPermissionRequirements(key).every(scoped);
  }
  return merged;
}

function filterNodeToJobOverridable(node: PermissionNode): PermissionNode | null {
  if (!JOB_OVERRIDABLE_KEYS.has(node.key)) return null;
  const children = node.children
    ?.map(filterNodeToJobOverridable)
    .filter((child): child is PermissionNode => child !== null);
  return {
    ...node,
    children: children && children.length > 0 ? children : undefined,
  };
}

/** Workflow sections for the per-job permissions editor (one pill per job tab area). */
export function jobEditableSectionsFromHierarchy(): PermissionHierarchyGroup[] {
  const jobsGroup = PERMISSION_HIERARCHY.find((group) => group.id === "jobs");
  if (!jobsGroup) return [];

  const nodes = filterHiddenFeatureNodes(
    jobsGroup.nodes.filter((node) => node.key !== "jobs.view"),
  );

  return nodes
    .map((node) => {
      const filtered = filterNodeToJobOverridable(node);
      if (!filtered) return null;
      return {
        id: filtered.key,
        label: filtered.label,
        help: filtered.help ?? node.help,
        nodes: [filtered],
      };
    })
    .filter((section) => section !== null) as unknown as PermissionHierarchyGroup[];
}

export function resolveEffectiveJobPermissions(params: {
  basePermissions: Partial<Record<PermissionKey, boolean>>;
  overrides: Partial<Record<PermissionKey, OverrideState>>;
}): Record<PermissionKey, boolean> {
  const base = params.basePermissions as Record<PermissionKey, boolean>;
  return mergeJobScopedPermissions(base, overridesToAllowDeny(params.overrides));
}

export function setJobOverrideWithImplications(
  current: Partial<Record<PermissionKey, OverrideState>>,
  key: PermissionKey,
  state: OverrideState,
): Partial<Record<PermissionKey, OverrideState>> {
  if (!JOB_OVERRIDABLE_KEYS.has(key) || isRoleLockedPermission(key)) return current;

  const next = { ...current, [key]: state };

  if (state === "ALLOW") {
    for (const requiredKey of getPermissionRequirements(key)) {
      if (JOB_OVERRIDABLE_KEYS.has(requiredKey) && !isRoleLockedPermission(requiredKey)) {
        next[requiredKey] = "ALLOW";
      }
    }
  }

  return next;
}

export function allowFullSection(
  current: Partial<Record<PermissionKey, OverrideState>>,
  section: PermissionHierarchyGroup,
): Partial<Record<PermissionKey, OverrideState>> {
  return allowFullPageOverrides(current, section);
}

export function turnSectionOff(
  current: Partial<Record<PermissionKey, OverrideState>>,
  section: PermissionHierarchyGroup,
): Partial<Record<PermissionKey, OverrideState>> {
  return turnPageOffOverrides(current, section);
}

export function resetSectionToDefaults(
  current: Partial<Record<PermissionKey, OverrideState>>,
  section: PermissionHierarchyGroup,
): Partial<Record<PermissionKey, OverrideState>> {
  return resetPageToDefaults(current, section);
}

export function resetAllSectionsToDefaults(
  current: Partial<Record<PermissionKey, OverrideState>>,
  sections: readonly PermissionHierarchyGroup[],
): Partial<Record<PermissionKey, OverrideState>> {
  let next = { ...current };
  for (const section of sections) {
    next = resetSectionToDefaults(next, section);
  }
  return next;
}

export function initialJobOverridesFromResponse(
  overrides: Partial<Record<PermissionKey, "ALLOW" | "DENY">> | undefined,
  sections: readonly PermissionHierarchyGroup[],
): Partial<Record<PermissionKey, OverrideState>> {
  const initial: Partial<Record<PermissionKey, OverrideState>> = {};
  for (const section of sections) {
    for (const node of flattenNodes(section.nodes)) {
      initial[node.key] = overrides?.[node.key] ?? "DEFAULT";
    }
  }
  return initial;
}

export function countAllowedInSection(
  section: PermissionHierarchyGroup,
  effectivePermissions: Record<PermissionKey, boolean>,
): number {
  return countAllowedInGroup(section, effectivePermissions);
}

export function editableKeysInSections(
  sections: readonly PermissionHierarchyGroup[],
): PermissionKey[] {
  return sections.flatMap((section) =>
    flattenNodes(section.nodes)
      .map((node) => node.key)
      .filter((key) => JOB_OVERRIDABLE_KEYS.has(key) && !isRoleLockedPermission(key)),
  );
}

export function sectionRootKey(section: PermissionHierarchyGroup): PermissionKey {
  return rootKeys(section)[0];
}
