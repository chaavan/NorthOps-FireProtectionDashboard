"use client";

import { useCallback, useEffect, useState } from "react";
import type { PermissionKey } from "@/lib/permissionCatalog";
import { evaluateClientPermission } from "@/lib/clientPermissionChecks";
import { useGlobalPermissionsContext } from "@/lib/PermissionsContext";

type PermissionState = {
  permissions: Partial<Record<PermissionKey, boolean>>;
  isDeveloper: boolean;
  isSuperAdmin: boolean;
};

type JobContext = {
  jobNumber?: string | null;
  listNumber?: string | null;
};

const EMPTY_STATE: PermissionState = {
  permissions: {},
  isDeveloper: false,
  isSuperAdmin: false,
};

/**
 * When called with a jobNumber, the returned permissions also reflect that
 * job's per-job overrides (lib/permissions.ts mergeJobScopedPermissions),
 * not just the user's global role permissions.
 */
export function usePermissions(jobContext?: JobContext) {
  const globalPermissions = useGlobalPermissionsContext();
  const jobNumber = jobContext?.jobNumber ?? null;
  const listNumber = jobContext?.listNumber ?? null;
  const hasJobContext = Boolean(jobNumber);

  const [state, setState] = useState<PermissionState>(EMPTY_STATE);
  const [isLoading, setIsLoading] = useState(hasJobContext);

  const refresh = useCallback(async (): Promise<PermissionState> => {
    if (!hasJobContext) {
      if (globalPermissions) {
        return {
          permissions: globalPermissions.permissions,
          isDeveloper: globalPermissions.isDeveloper,
          isSuperAdmin: globalPermissions.isSuperAdmin,
        };
      }
      return EMPTY_STATE;
    }

    try {
      setIsLoading(true);
      const query = new URLSearchParams();
      query.set("jobNumber", jobNumber!);
      if (listNumber) query.set("listNumber", listNumber);
      const response = await fetch(`/api/auth/me/permissions?${query.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        setState(EMPTY_STATE);
        return EMPTY_STATE;
      }
      const data = await response.json();
      const nextState = {
        permissions: data.permissions || {},
        isDeveloper: Boolean(data.isDeveloper),
        isSuperAdmin: Boolean(data.isSuperAdmin),
      };
      setState(nextState);
      return nextState;
    } catch {
      setState(EMPTY_STATE);
      return EMPTY_STATE;
    } finally {
      setIsLoading(false);
    }
  }, [globalPermissions, hasJobContext, jobNumber, listNumber]);

  useEffect(() => {
    if (!hasJobContext) return;
    void refresh();
  }, [hasJobContext, refresh]);

  const hasPermission = useCallback(
    (key: PermissionKey) => {
      if (!hasJobContext && globalPermissions) {
        return globalPermissions.hasPermission(key);
      }
      return evaluateClientPermission(key, state);
    },
    [globalPermissions, hasJobContext, state],
  );

  if (!hasJobContext && globalPermissions) {
    return globalPermissions;
  }

  return {
    ...state,
    isLoading,
    hasPermission,
    refresh,
  };
}
