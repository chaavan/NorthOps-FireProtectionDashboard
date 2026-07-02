import {
  AUTO_ADD_JOB_ACCESS_KEY,
  PERMISSION_HIERARCHY,
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
import { resolvePermissionsFromTemplateAndOverrides } from "@/lib/permissionResolution";

export type OverrideState = "DEFAULT" | "ALLOW" | "DENY";

export function flattenNodes(nodes: readonly PermissionNode[]): PermissionNode[] {
  return nodes.flatMap((node) => [node, ...flattenNodes(node.children ?? [])]);
}

export function filterHiddenFeatureNodes(nodes: readonly PermissionNode[]): PermissionNode[] {
  const preorderEnabled = isJobPreorderEnabled();
  return nodes
    .filter((node) => preorderEnabled || !node.key.startsWith("job.preorder."))
    .map((node) => ({
      ...node,
      children: node.children ? filterHiddenFeatureNodes(node.children) : undefined,
    }));
}

export function rootKeys(group: PermissionHierarchyGroup): PermissionKey[] {
  return group.nodes.map((node) => node.key);
}

export function editableGroupsFromHierarchy() {
  return PERMISSION_HIERARCHY.filter((group) => !isRolePermissionGroupHidden(group.id))
    .map((group) => ({
      ...group,
      nodes: filterHiddenFeatureNodes(group.nodes),
    }))
    .filter((group) => group.nodes.length > 0);
}

export function overridesToAllowDeny(
  overrides: Partial<Record<PermissionKey, OverrideState>>,
): Partial<Record<PermissionKey, "ALLOW" | "DENY">> {
  const result: Partial<Record<PermissionKey, "ALLOW" | "DENY">> = {};
  for (const [key, state] of Object.entries(overrides)) {
    if (state === "ALLOW" || state === "DENY") {
      result[key as PermissionKey] = state;
    }
  }
  return result;
}

export function resolveEffectiveUserPermissions(params: {
  template: Record<PermissionKey, boolean>;
  overrides: Partial<Record<PermissionKey, OverrideState>>;
  isSuperAdmin: boolean;
  isDeveloper: boolean;
}): Record<PermissionKey, boolean> {
  return resolvePermissionsFromTemplateAndOverrides(
    params.template,
    overridesToAllowDeny(params.overrides),
    {
      isSuperAdmin: params.isSuperAdmin,
      isDeveloper: params.isDeveloper,
    },
  );
}

export function isEffectivelyAllowed(
  key: PermissionKey,
  effectivePermissions: Record<PermissionKey, boolean>,
): boolean {
  if (isPermissionToggleLocked(key, effectivePermissions)) return true;
  if (effectivePermissions[key] !== true) return false;
  if (key === AUTO_ADD_JOB_ACCESS_KEY && !canUseAutoAddJobAccess(effectivePermissions)) {
    return false;
  }
  return getPermissionRequirements(key).every(
    (requiredKey) => effectivePermissions[requiredKey] === true,
  );
}

export function countAllowedInGroup(
  group: PermissionHierarchyGroup,
  effectivePermissions: Record<PermissionKey, boolean>,
): number {
  return flattenNodes(group.nodes).filter((node) =>
    isEffectivelyAllowed(node.key, effectivePermissions),
  ).length;
}

export function setOverrideWithImplications(
  current: Partial<Record<PermissionKey, OverrideState>>,
  key: PermissionKey,
  state: OverrideState,
): Partial<Record<PermissionKey, OverrideState>> {
  if (isRoleLockedPermission(key)) return current;

  const next = { ...current, [key]: state };

  if (state === "DENY" && key === "jobs.view") {
    next["jobs.view_contract_jobs"] = "DENY";
    next["jobs.view_service_jobs"] = "DENY";
  }
  if (state === "DENY" && key === "orders.to_order.view") {
    next["orders.to_order.edit"] = "DENY";
    next["orders.generate_send"] = "DENY";
  }
  if (state === "ALLOW") {
    for (const requiredKey of getPermissionRequirements(key)) {
      if (!isRoleLockedPermission(requiredKey)) next[requiredKey] = "ALLOW";
    }
    if (key === "job_import.view") {
      next["job_import.drafts.view_own"] = "ALLOW";
    }
  }

  return next;
}

export function allowFullPageOverrides(
  current: Partial<Record<PermissionKey, OverrideState>>,
  group: PermissionHierarchyGroup,
): Partial<Record<PermissionKey, OverrideState>> {
  const next = { ...current };
  for (const key of flattenNodes(group.nodes).map((node) => node.key)) {
    if (!isRoleLockedPermission(key)) next[key] = "ALLOW";
  }
  return next;
}

export function turnPageOffOverrides(
  current: Partial<Record<PermissionKey, OverrideState>>,
  group: PermissionHierarchyGroup,
): Partial<Record<PermissionKey, OverrideState>> {
  const next = { ...current };
  for (const key of rootKeys(group)) {
    if (!isRoleLockedPermission(key)) next[key] = "DENY";
  }
  if (group.id === "jobs") {
    next["jobs.view_contract_jobs"] = "DENY";
    next["jobs.view_service_jobs"] = "DENY";
  }
  return next;
}

export function resetPageToDefaults(
  current: Partial<Record<PermissionKey, OverrideState>>,
  group: PermissionHierarchyGroup,
): Partial<Record<PermissionKey, OverrideState>> {
  const next = { ...current };
  for (const key of flattenNodes(group.nodes).map((node) => node.key)) {
    if (!isRoleLockedPermission(key)) next[key] = "DEFAULT";
  }
  return next;
}

export function initialOverridesFromResponse(
  overrides: Partial<Record<PermissionKey, "ALLOW" | "DENY">> | undefined,
): Partial<Record<PermissionKey, OverrideState>> {
  const initial: Partial<Record<PermissionKey, OverrideState>> = {};
  for (const group of PERMISSION_HIERARCHY) {
    for (const node of flattenNodes(group.nodes)) {
      initial[node.key] = overrides?.[node.key] ?? "DEFAULT";
    }
  }
  return initial;
}
