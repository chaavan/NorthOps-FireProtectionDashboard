"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type JobListOption = {
  listNumber: string;
  area: string | null;
};

type JobListSwitcherProps = {
  jobNumber: string;
  currentListNumber: string | null;
  onListChange: (listNumber: string) => void;
  onInaccessibleCurrentList?: (fallbackListNumber: string) => void;
};

function formatListLabel(listNumber: string, area: string | null): string {
  const trimmedArea = area?.trim();
  if (trimmedArea) {
    return `${listNumber} — ${trimmedArea}`;
  }
  return listNumber;
}

export default function JobListSwitcher({
  jobNumber,
  currentListNumber,
  onListChange,
  onInaccessibleCurrentList,
}: JobListSwitcherProps) {
  const [lists, setLists] = useState<JobListOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  const loadLists = useCallback(async () => {
    if (!jobNumber?.trim()) {
      setLists([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/jobs/${encodeURIComponent(jobNumber)}/lists`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        setLists([]);
        return;
      }
      const data = (await response.json()) as { lists?: JobListOption[] };
      setLists(Array.isArray(data.lists) ? data.lists : []);
    } catch {
      setLists([]);
    } finally {
      setIsLoading(false);
    }
  }, [jobNumber]);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  useEffect(() => {
    if (isLoading || lists.length === 0 || !currentListNumber?.trim()) {
      return;
    }
    const hasCurrent = lists.some(
      (list) => list.listNumber === currentListNumber.trim(),
    );
    if (!hasCurrent && onInaccessibleCurrentList) {
      onInaccessibleCurrentList(lists[0].listNumber);
    }
  }, [currentListNumber, isLoading, lists, onInaccessibleCurrentList]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  if (!isLoading && lists.length === 0) {
    return null;
  }

  const displayListNumber =
    currentListNumber?.trim() || lists[0]?.listNumber || null;

  if (!displayListNumber && isLoading) {
    return null;
  }

  if (!displayListNumber) {
    return null;
  }

  const currentList =
    lists.find((list) => list.listNumber === displayListNumber) ?? null;
  const currentLabel = formatListLabel(
    displayListNumber,
    currentList?.area ?? null,
  );

  if (isLoading || lists.length <= 1) {
    return (
      <span className="ml-3 whitespace-nowrap">
        List #: {displayListNumber}
      </span>
    );
  }

  return (
    <span ref={containerRef} className="relative ml-3 inline-flex items-center">
      <span className="mr-1">List #:</span>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="inline-flex max-w-[14rem] items-center gap-1 rounded-md border border-slate-300/80 bg-white/80 px-2 py-0.5 text-left text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 dark:border-slate-600/80 dark:bg-slate-900/40 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:bg-slate-800/60"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="truncate font-medium">{currentLabel}</span>
        <svg
          className={`h-3.5 w-3.5 flex-shrink-0 text-slate-500 transition-transform dark:text-slate-400 ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isOpen && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-50 mt-1 min-w-[12rem] max-w-[18rem] max-h-60 overflow-y-auto overscroll-contain rounded-lg border border-slate-200 bg-white shadow-lg ring-1 ring-slate-200/60 dark:border-slate-600 dark:bg-slate-800 dark:ring-slate-700/40"
        >
          {lists.map((list) => {
            const isSelected = list.listNumber === displayListNumber;
            const label = formatListLabel(list.listNumber, list.area);
            return (
              <button
                key={list.listNumber}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  setIsOpen(false);
                  if (list.listNumber !== displayListNumber) {
                    onListChange(list.listNumber);
                  }
                }}
                className={`block w-full truncate px-3 py-2 text-left text-sm transition-colors ${
                  isSelected
                    ? "bg-blue-50 font-semibold text-blue-800 dark:bg-blue-500/20 dark:text-blue-200"
                    : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700/60"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}
