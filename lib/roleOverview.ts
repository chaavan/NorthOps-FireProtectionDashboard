import {
  ALL_PERMISSION_KEYS,
  PERMISSION_GROUPS,
  applyRoleLockedPermissions,
  isRoleLockedPermission,
  isRolePermissionGroupHidden,
  type PermissionKey,
} from "@/lib/permissionCatalog";

export type PageAccessSummary = {
  id: string;
  label: string;
  allowed: number;
  total: number;
  percent: number;
  status: "full" | "partial" | "off";
};

export type RoleOverviewStats = {
  assignedUsers: number;
  permissionsAllowed: number;
  totalAdjustablePermissions: number;
  pagesFullyOn: number;
  pagesPartial: number;
  pagesOff: number;
  pagesEnabledLabel: string;
  pageSummaries: PageAccessSummary[];
};

function getEditableGroupPermissions(groupId: string) {
  const group = PERMISSION_GROUPS.find((entry) => entry.id === groupId);
  if (!group) return [];
  return group.permissions.filter(([key]) => !isRoleLockedPermission(key));
}

export function computeRoleOverviewStats(
  permissions: Partial<Record<PermissionKey, boolean>>,
  userCount = 0,
): RoleOverviewStats {
  const basePermissions = Object.fromEntries(
    ALL_PERMISSION_KEYS.map((key) => [key, Boolean(permissions[key])]),
  ) as Record<PermissionKey, boolean>;
  const resolved = applyRoleLockedPermissions(basePermissions);
  const visibleGroups = PERMISSION_GROUPS.filter((group) => !isRolePermissionGroupHidden(group.id));

  let permissionsAllowed = 0;
  let totalAdjustablePermissions = 0;
  let pagesFullyOn = 0;
  let pagesPartial = 0;
  let pagesOff = 0;

  const pageSummaries: PageAccessSummary[] = visibleGroups.map((group) => {
    const editable = getEditableGroupPermissions(group.id);
    const total = editable.length;
    const allowed = editable.filter(([key]) => Boolean(resolved[key])).length;
    totalAdjustablePermissions += total;
    permissionsAllowed += allowed;

    let status: PageAccessSummary["status"] = "off";
    if (total === 0) {
      status = "full";
    } else if (allowed === total) {
      status = "full";
      pagesFullyOn += 1;
    } else if (allowed === 0) {
      status = "off";
      pagesOff += 1;
    } else {
      status = "partial";
      pagesPartial += 1;
    }

    const percent = total > 0 ? Math.round((allowed / total) * 100) : 100;

    return {
      id: group.id,
      label: group.label,
      allowed,
      total,
      percent,
      status,
    };
  });

  const enabledPages = pagesFullyOn + pagesPartial;
  const pagesEnabledLabel =
    enabledPages === 0
      ? "None"
      : pagesPartial === 0 && pagesOff === 0
        ? `${pagesFullyOn} full`
        : `${enabledPages} active`;

  return {
    assignedUsers: userCount,
    permissionsAllowed,
    totalAdjustablePermissions,
    pagesFullyOn,
    pagesPartial,
    pagesOff,
    pagesEnabledLabel,
    pageSummaries,
  };
}
