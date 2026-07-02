"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSession } from "next-auth/react";
import type { PermissionKey } from "@/lib/permissionCatalog";
import { evaluateClientPermission } from "@/lib/clientPermissionChecks";

type PermissionState = {
  permissions: Partial<Record<PermissionKey, boolean>>;
  isDeveloper: boolean;
  isSuperAdmin: boolean;
};

type PermissionsContextValue = PermissionState & {
  isLoading: boolean;
  hasPermission: (key: PermissionKey) => boolean;
  refresh: () => Promise<PermissionState>;
};

const EMPTY_STATE: PermissionState = {
  permissions: {},
  isDeveloper: false,
  isSuperAdmin: false,
};

const PermissionsContext = createContext<PermissionsContextValue | null>(null);

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const [state, setState] = useState<PermissionState>(EMPTY_STATE);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async (): Promise<PermissionState> => {
    if (status !== "authenticated") {
      setState(EMPTY_STATE);
      setIsLoading(false);
      return EMPTY_STATE;
    }

    try {
      setIsLoading(true);
      const response = await fetch("/api/auth/me/permissions", {
        cache: "no-store",
      });
      if (!response.ok) {
        setState(EMPTY_STATE);
        return EMPTY_STATE;
      }

      const data = await response.json();
      const nextState: PermissionState = {
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
  }, [status]);

  useEffect(() => {
    if (status === "loading") return;
    void refresh();
  }, [refresh, status]);

  const hasPermission = useCallback(
    (key: PermissionKey) => evaluateClientPermission(key, state),
    [state],
  );

  const value = useMemo(
    () => ({
      ...state,
      isLoading,
      hasPermission,
      refresh,
    }),
    [state, isLoading, hasPermission, refresh],
  );

  return (
    <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>
  );
}

export function useGlobalPermissionsContext(): PermissionsContextValue | null {
  return useContext(PermissionsContext);
}
