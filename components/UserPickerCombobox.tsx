'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';

export interface UserPickerOption {
  email: string;
  name: string | null;
}

interface UserPickerComboboxProps {
  id?: string;
  users: UserPickerOption[];
  value: string;
  onChange: (email: string) => void;
  /** Emails already chosen in other rows; current `value` is always allowed */
  excludedEmails?: string[];
  disabled?: boolean;
  error?: boolean;
  placeholder?: string;
}

function displayLabel(users: UserPickerOption[], email: string): string {
  const trimmed = email.trim();
  if (!trimmed) return '';
  const u = users.find((x) => x.email.toLowerCase() === trimmed.toLowerCase());
  if (!u) return trimmed;
  return u.name?.trim() ? u.name : u.email;
}

export default function UserPickerCombobox({
  id,
  users,
  value,
  onChange,
  excludedEmails = [],
  disabled = false,
  error = false,
  placeholder = 'Search by name or email…',
}: UserPickerComboboxProps) {
  const [inputValue, setInputValue] = useState(() => displayLabel(users, value));
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const lastCommittedValueRef = useRef(value);

  const excludedLower = useMemo(() => {
    const s = new Set<string>();
    for (const e of excludedEmails) {
      const t = e.trim().toLowerCase();
      if (t) s.add(t);
    }
    return s;
  }, [excludedEmails]);

  const filtered = useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    return users.filter((u) => {
      const el = u.email.toLowerCase();
      if (excludedLower.has(el)) {
        return false;
      }
      if (!q) return true;
      const name = (u.name || '').toLowerCase();
      return name.includes(q) || el.includes(q);
    });
  }, [users, inputValue, excludedLower]);

  useEffect(() => {
    if (value !== lastCommittedValueRef.current) {
      lastCommittedValueRef.current = value;
      if (!value.trim()) {
        setInputValue('');
      } else {
        setInputValue(displayLabel(users, value));
      }
      return;
    }
    if (value.trim()) {
      setInputValue(displayLabel(users, value));
    }
  }, [value, users]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current?.contains(e.target as Node)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    if (!isOpen || filtered.length === 0) {
      setHighlightedIndex(-1);
      return;
    }
    setHighlightedIndex(0);
  }, [isOpen, filtered.length, inputValue]);

  useEffect(() => {
    if (!isOpen || highlightedIndex < 0 || !listRef.current) return;
    const el = listRef.current.children[highlightedIndex] as HTMLElement;
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [highlightedIndex, isOpen]);

  const commitSelection = useCallback(
    (email: string) => {
      onChange(email);
      setInputValue(displayLabel(users, email));
      setIsOpen(false);
      setHighlightedIndex(-1);
    },
    [onChange, users],
  );

  const handleSelectUser = useCallback(
    (u: UserPickerOption) => {
      commitSelection(u.email);
    },
    [commitSelection],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      if (value.trim()) {
        setInputValue(displayLabel(users, value));
      } else {
        setInputValue('');
      }
      return;
    }

    if (!isOpen || filtered.length === 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((i) => (i < filtered.length - 1 ? i + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((i) => (i > 0 ? i - 1 : filtered.length - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && filtered[highlightedIndex]) {
          handleSelectUser(filtered[highlightedIndex]);
        }
        break;
      default:
        break;
    }
  };

  const inputBaseClass =
    'w-full px-4 py-2.5 pr-10 bg-white dark:bg-slate-800/80 border rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-500 shadow-sm transition-all';
  const inputBorderClass = error
    ? 'border-red-500'
    : 'border-gray-300 dark:border-slate-600/80 hover:border-gray-400 dark:hover:border-slate-500/80';

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          type="text"
          id={id}
          value={inputValue}
          onChange={(e) => {
            const v = e.target.value;
            setInputValue(v);
            setIsOpen(true);
            if (v === '') {
              onChange('');
            }
          }}
          onFocus={(e) => {
            setIsOpen(true);
            if (value.trim()) {
              e.target.select();
            }
          }}
          onBlur={() => {
            window.setTimeout(() => {
              setIsOpen(false);
              if (value.trim()) {
                setInputValue(displayLabel(users, value));
              }
            }, 120);
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          aria-controls={id ? `${id}-listbox` : undefined}
          className={`${inputBaseClass} ${inputBorderClass}`}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label="Show user list"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 disabled:opacity-50"
          onMouseDown={(e) => {
            e.preventDefault();
            setIsOpen((o) => !o);
          }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {isOpen && (
        <ul
          id={id ? `${id}-listbox` : undefined}
          ref={listRef}
          role="listbox"
          className="absolute z-50 w-full mt-1 max-h-60 overflow-auto rounded-xl border border-slate-200 dark:border-slate-600/80 bg-white dark:bg-slate-800 shadow-lg py-1"
        >
          {filtered.length === 0 ? (
            <li className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400" role="option">
              {users.length === 0 ? 'No users loaded' : 'No matching users'}
            </li>
          ) : (
            filtered.map((u, index) => (
              <li
                key={u.email}
                role="option"
                aria-selected={index === highlightedIndex}
                className={`px-4 py-2.5 cursor-pointer text-sm transition-colors ${
                  index === highlightedIndex
                    ? 'bg-blue-100 dark:bg-blue-900/30 text-slate-900 dark:text-white'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50'
                }`}
                onMouseEnter={() => setHighlightedIndex(index)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelectUser(u);
                }}
              >
                <span className="font-semibold text-slate-900 dark:text-white">
                  {u.name?.trim() || u.email}
                </span>
                {u.name?.trim() ? (
                  <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">
                    {u.email}
                  </span>
                ) : null}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
