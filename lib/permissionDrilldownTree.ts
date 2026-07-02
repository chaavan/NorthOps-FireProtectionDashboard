import {
  AUTO_ADD_JOB_ACCESS_KEY,
  canUseAutoAddJobAccess,
  getPermissionRequirements,
  isPermissionToggleLocked,
  type PermissionKey,
  type PermissionNode,
} from "@/lib/permissionCatalog";

export type OrgNode = { node: PermissionNode; kids: OrgNode[] };

export function buildOrgTree(nodes: readonly PermissionNode[]): OrgNode {
  const trueRoot = nodes.find((node) => !node.requires || node.requires.length === 0) ?? nodes[0];
  const dependents = nodes.filter(
    (node) => node.key !== trueRoot.key && node.requires?.includes(trueRoot.key),
  );

  const expand = (node: PermissionNode, extraDependents: PermissionNode[] = []): OrgNode => {
    const ownChildren = node.key === "jobs.view" ? [] : node.children ?? [];
    const kids = [...ownChildren, ...extraDependents].map((child) => expand(child));
    return { node, kids };
  };

  return expand(trueRoot, dependents);
}

export function resolvePath(root: OrgNode, path: PermissionKey[]): OrgNode[] {
  const trail: OrgNode[] = [root];
  let current = root;
  for (const key of path.slice(1)) {
    const next = current.kids.find((kid) => kid.node.key === key);
    if (!next) break;
    trail.push(next);
    current = next;
  }
  return trail;
}

export function partitionChildren(kids: OrgNode[]): { leaves: OrgNode[]; sections: OrgNode[] } {
  return {
    leaves: kids.filter((kid) => kid.kids.length === 0),
    sections: kids.filter((kid) => kid.kids.length > 0),
  };
}

export function flattenOrgNodes(n: OrgNode, acc: OrgNode[] = []): OrgNode[] {
  for (const kid of n.kids) {
    acc.push(kid);
    flattenOrgNodes(kid, acc);
  }
  return acc;
}

export function isDisabledByParent(
  key: PermissionKey,
  permissions: Partial<Record<PermissionKey, boolean>>,
): boolean {
  if (isPermissionToggleLocked(key, permissions)) return false;
  if (key === AUTO_ADD_JOB_ACCESS_KEY) {
    return !canUseAutoAddJobAccess(permissions);
  }
  return getPermissionRequirements(key).some((req) => permissions[req] !== true);
}

export function countAllowedInSubtree(
  n: OrgNode,
  permissions: Partial<Record<PermissionKey, boolean>>,
  isAllowed: (key: PermissionKey, permissions: Partial<Record<PermissionKey, boolean>>) => boolean,
): { allowed: number; total: number } {
  const descendants = flattenOrgNodes(n);
  const allowed = descendants.filter((descendant) =>
    isAllowed(descendant.node.key, permissions),
  ).length;
  return { allowed, total: descendants.length };
}
