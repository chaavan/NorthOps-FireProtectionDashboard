"use client";

import { useCallback, useEffect, useState } from "react";
import type { PermissionKey } from "@/lib/permissionCatalog";

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
  const [state, setState] = useState<PermissionState>(EMPTY_STATE);
  const [isLoading, setIsLoading] = useState(true);
  const jobNumber = jobContext?.jobNumber ?? null;
  const listNumber = jobContext?.listNumber ?? null;

  const refresh = useCallback(async (): Promise<PermissionState> => {
    try {
      setIsLoading(true);
      const query = new URLSearchParams();
      if (jobNumber) {
        query.set("jobNumber", jobNumber);
        if (listNumber) query.set("listNumber", listNumber);
      }
      const qs = query.toString();
      const response = await fetch(`/api/auth/me/permissions${qs ? `?${qs}` : ""}`, {
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
  }, [jobNumber, listNumber]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasPermission = useCallback(
    (key: PermissionKey) => state.permissions[key] === true,
    [state.permissions],
  );

  return {
    ...state,
    isLoading,
    hasPermission,
    refresh,
  };
}
