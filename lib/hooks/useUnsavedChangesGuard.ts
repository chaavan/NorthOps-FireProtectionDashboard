"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type UnsavedChangesHandle = {
  hasUnsavedChanges: () => boolean;
  saveNow: () => Promise<boolean>;
};

/**
 * Blocks in-app navigation and logout while a guarded editor (anything
 * exposing UnsavedChangesHandle via ref) has unsaved changes, prompting the
 * user to save before continuing. Does not handle tab close/refresh — pair
 * with a `beforeunload` listener in the guarded editor for that.
 */
export function useUnsavedChangesGuard() {
  const router = useRouter();
  const targetRef = useRef<UnsavedChangesHandle | null>(null);
  const pendingActionRef = useRef<(() => void) | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isResolving, setIsResolving] = useState(false);

  const requestLeave = useCallback((action: () => void): boolean | Promise<boolean> => {
    if (!targetRef.current?.hasUnsavedChanges()) return true;
    pendingActionRef.current = action;
    setIsOpen(true);
    return false;
  }, []);

  const onBeforeNavigate = useCallback(
    (path: string) => requestLeave(() => router.push(path)),
    [requestLeave, router],
  );

  const confirmSaveAndLeave = useCallback(async () => {
    setIsResolving(true);
    const ok = await targetRef.current?.saveNow();
    setIsResolving(false);
    setIsOpen(false);
    if (ok) {
      pendingActionRef.current?.();
    }
    pendingActionRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    setIsOpen(false);
    pendingActionRef.current = null;
  }, []);

  return { targetRef, requestLeave, onBeforeNavigate, isOpen, isResolving, confirmSaveAndLeave, cancel };
}
