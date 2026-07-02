'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export interface PartSearchOption {
  pn: string;
  nomenclature: string | null;
  units?: string | null;
  vendor?: string | null;
}

interface PartSearchComboboxProps {
  value: string;
  onChange: (value: string) => void;
  onPartSelect?: (part: PartSearchOption) => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  error?: boolean | string;
  inputClassName?: string;
  required?: boolean;
  /** Show loading indicator (e.g. when parent is fetching part details) */
  showLoadingIndicator?: boolean;
  /**
   * `focus` — open dropdown on focus when the query is long enough (default).
   * `input` — only search/open after the user types or pastes in the field (no dropdown on click/focus alone).
   */
  dropdownTrigger?: 'focus' | 'input';
  /**
   * When provided, the combobox does NOT hit the parts catalog API. Instead it filters this
   * static list locally by part number or description. Use this to restrict selection to a
   * specific subset of parts (e.g. parts that exist on a given job/list).
   */
  options?: PartSearchOption[];
  permissionContext?: {
    jobNumber?: string | null;
    listNumber?: string | null;
  };
}

const SEARCH_DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 2;
const SEARCH_LIMIT = 25;

export default function PartSearchCombobox({
  value,
  onChange,
  onPartSelect,
  onBlur,
  placeholder = 'Search by part number or description...',
  disabled = false,
  id,
  className = '',
  error,
  inputClassName = '',
  required,
  showLoadingIndicator = false,
  dropdownTrigger = 'focus',
  options,
  permissionContext,
}: PartSearchComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState<PartSearchOption[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /** When true, next value change is from a selection - don't reopen dropdown or refetch */
  const ignoreNextValueChangeRef = useRef(false);
  /** For `dropdownTrigger="input"`: user has typed/pasted since focus; skip auto-search until then */
  const userEditedSinceFocusRef = useRef(false);

  const hasError = typeof error === 'string' ? !!error : !!error;

  const fetchResults = useCallback(
    async (query: string) => {
      if (query.length < MIN_QUERY_LENGTH) {
        setResults([]);
        return;
      }
      // Local filtering mode: filter the provided options instead of hitting the API.
      if (options) {
        const q = query.trim().toLowerCase();
        const filtered = options
          .filter((p) => {
            const pn = (p.pn || "").toLowerCase();
            const nom = (p.nomenclature || "").toLowerCase();
            return pn.includes(q) || nom.includes(q);
          })
          .slice(0, SEARCH_LIMIT);
        setResults(filtered);
        setHighlightedIndex(filtered.length > 0 ? 0 : -1);
        return;
      }
      setIsSearching(true);
      try {
        const params = new URLSearchParams({
          q: query.trim(),
          limit: String(SEARCH_LIMIT),
        });
        if (permissionContext?.jobNumber) {
          params.set('jobNumber', permissionContext.jobNumber);
        }
        if (permissionContext?.listNumber) {
          params.set('listNumber', permissionContext.listNumber);
        }
        const response = await fetch(`/api/parts/search?${params}`);
        if (!response.ok) {
          setResults([]);
          return;
        }
        const data = await response.json();
        const parts = (data.results || []).map(
          (p: {
            partNumber: string;
            description: string | null;
            uom?: string | null;
            vendor?: string | null;
          }) => ({
            pn: p.partNumber,
            nomenclature: p.description ?? null,
            units: p.uom ?? null,
            vendor: p.vendor ?? null,
          }),
        );
        setResults(parts);
        setHighlightedIndex(parts.length > 0 ? 0 : -1);
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    },
    [options, permissionContext?.jobNumber, permissionContext?.listNumber],
  );

  // Sync search when user types: debounce and fetch (skip when value changed from a selection)
  useEffect(() => {
    if (ignoreNextValueChangeRef.current) {
      ignoreNextValueChangeRef.current = false;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      return;
    }

    if (dropdownTrigger === 'input' && !userEditedSinceFocusRef.current) {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      setResults([]);
      setIsOpen(false);
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    if (value.length >= MIN_QUERY_LENGTH) {
      debounceRef.current = setTimeout(() => {
        fetchResults(value);
        setIsOpen(true);
        debounceRef.current = null;
      }, SEARCH_DEBOUNCE_MS);
    } else {
      setResults([]);
      if (value.length === 0) setIsOpen(false);
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, fetchResults, dropdownTrigger]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = useCallback(
    (part: PartSearchOption) => {
      ignoreNextValueChangeRef.current = true; // parent will update value; don't reopen dropdown
      onChange(part.pn);
      onPartSelect?.(part);
      setIsOpen(false);
      setResults([]);
    },
    [onChange, onPartSelect]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) {
      if (e.key === 'Escape') setIsOpen(false);
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((i) => (i < results.length - 1 ? i + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((i) => (i > 0 ? i - 1 : results.length - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && results[highlightedIndex]) {
          handleSelect(results[highlightedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        break;
      default:
        break;
    }
  };

  // Scroll highlighted option into view
  useEffect(() => {
    if (!isOpen || highlightedIndex < 0 || !listRef.current) return;
    const option = listRef.current.children[highlightedIndex] as HTMLElement;
    if (option) option.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [highlightedIndex, isOpen]);

  const showDropdown = isOpen && (value.length > 0 || results.length > 0);
  const displayMessage =
    value.length > 0 && value.length < MIN_QUERY_LENGTH
      ? 'Type at least 2 characters to search'
      : null;

  const inputBaseClass =
    'w-full px-4 py-2.5 bg-white dark:bg-slate-800/80 border rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-500 shadow-sm transition-all';
  const inputErrorClass = hasError ? 'border-red-500' : 'border-gray-300 dark:border-slate-600/80 hover:border-gray-400 dark:hover:border-slate-500/80';

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          type="text"
          id={id}
          value={value}
          onChange={(e) => {
            if (dropdownTrigger === 'input') {
              userEditedSinceFocusRef.current = true;
            }
            onChange(e.target.value);
          }}
          onFocus={() => {
            if (dropdownTrigger === 'input') {
              userEditedSinceFocusRef.current = false;
              setIsOpen(false);
              return;
            }
            if (value.length >= MIN_QUERY_LENGTH) setIsOpen(true);
            if (value.length > 0 && value.length < MIN_QUERY_LENGTH) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          onBlur={onBlur}
          disabled={disabled}
          required={required}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          aria-controls="part-search-listbox"
          aria-activedescendant={highlightedIndex >= 0 ? `part-option-${highlightedIndex}` : undefined}
          className={`${inputBaseClass} ${inputErrorClass} ${inputClassName}`}
        />
        {showLoadingIndicator && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent" />
          </div>
        )}
      </div>

      {showDropdown && (
        <ul
          id="part-search-listbox"
          ref={listRef}
          role="listbox"
          className="absolute z-50 w-full mt-1 max-h-60 overflow-auto rounded-xl border border-slate-200 dark:border-slate-600/80 bg-white dark:bg-slate-800 shadow-lg py-1"
        >
          {isSearching ? (
            <li className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400" role="option">
              Searching...
            </li>
          ) : displayMessage ? (
            <li className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400" role="option">
              {displayMessage}
            </li>
          ) : results.length === 0 ? (
            <li className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400" role="option">
              No parts found
            </li>
          ) : (
            results.map((part, index) => (
              <li
                key={`${part.pn}-${index}`}
                id={`part-option-${index}`}
                role="option"
                aria-selected={index === highlightedIndex}
                className={`px-4 py-2.5 cursor-pointer text-sm transition-colors ${
                  index === highlightedIndex
                    ? 'bg-blue-100 dark:bg-blue-900/30 text-slate-900 dark:text-white'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50'
                }`}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => handleSelect(part)}
              >
                <span className="font-semibold text-slate-900 dark:text-white">{part.pn}</span>
                {part.nomenclature && (
                  <span className="ml-2 text-slate-500 dark:text-slate-400 truncate block">
                    {part.nomenclature.length > 60 ? `${part.nomenclature.slice(0, 60)}…` : part.nomenclature}
                  </span>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
