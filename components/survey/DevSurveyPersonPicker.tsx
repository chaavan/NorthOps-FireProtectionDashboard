"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type SurveyRespondentOption = {
  userId: string;
  userName?: string | null;
  userEmail: string;
  department?: string | null;
  status: "COMPLETE" | "INCOMPLETE";
};

type Props = {
  respondents: SurveyRespondentOption[];
  selectedUserId: string | null;
  onSelect: (userId: string | null) => void;
  /** Shown when there are no saved responses for the selected round. */
  emptyMessage?: string;
};

function displayLabel(person: SurveyRespondentOption): string {
  const name = person.userName?.trim();
  return name ? `${name} (${person.userEmail})` : person.userEmail;
}

function matchesSearch(person: SurveyRespondentOption, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    person.userName || "",
    person.userEmail,
    person.department || "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

export default function DevSurveyPersonPicker({
  respondents,
  selectedUserId,
  onSelect,
  emptyMessage = "No one has saved a response for this round yet.",
}: Props) {
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);

  const sorted = useMemo(
    () =>
      [...respondents].sort((a, b) =>
        (a.userName || a.userEmail).localeCompare(b.userName || b.userEmail),
      ),
    [respondents],
  );

  const filtered = useMemo(
    () => sorted.filter((person) => matchesSearch(person, query)),
    [query, sorted],
  );

  const selected = useMemo(
    () => sorted.find((person) => person.userId === selectedUserId) || null,
    [selectedUserId, sorted],
  );

  useEffect(() => {
    setHighlightIndex(0);
  }, [query, isOpen]);

  useEffect(() => {
    if (!selected) return;
    setQuery(displayLabel(selected));
  }, [selected]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const pickPerson = (person: SurveyRespondentOption) => {
    onSelect(person.userId);
    setQuery(displayLabel(person));
    setIsOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsOpen(true);
      setHighlightIndex((index) => Math.min(index + 1, Math.max(0, filtered.length - 1)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      setHighlightIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (isOpen && filtered[highlightIndex]) {
        pickPerson(filtered[highlightIndex]);
      }
      return;
    }
    if (event.key === "Escape") {
      setIsOpen(false);
    }
  };

  if (respondents.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-slate-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <label className="mb-2 block text-xs font-bold uppercase tracking-[0.25em] text-slate-300">
        Select person
      </label>
      <input
        type="text"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-autocomplete="list"
        placeholder="Search by name, email, or department..."
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
          if (!event.target.value.trim()) {
            onSelect(null);
          }
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={onKeyDown}
        className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none focus:border-cyan-300"
      />
      {isOpen ? (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-xl border border-white/10 bg-slate-900 py-1 shadow-2xl"
        >
          {filtered.length === 0 ? (
            <li className="px-4 py-3 text-sm text-slate-400">No matching people.</li>
          ) : (
            filtered.map((person, index) => {
              const isHighlighted = index === highlightIndex;
              const isSelected = person.userId === selectedUserId;
              return (
                <li key={person.userId} role="option" aria-selected={isSelected}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlightIndex(index)}
                    onClick={() => pickPerson(person)}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition ${
                      isHighlighted || isSelected
                        ? "bg-cyan-400/15 text-white"
                        : "text-slate-200 hover:bg-white/5"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {displayLabel(person)}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                        person.status === "COMPLETE"
                          ? "bg-emerald-400/20 text-emerald-200"
                          : "bg-sky-400/20 text-sky-200"
                      }`}
                    >
                      {person.status === "COMPLETE" ? "Complete" : "Draft"}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
