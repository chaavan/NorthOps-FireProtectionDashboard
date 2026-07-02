"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import type { JobInfo } from "@/lib/types";

interface JobSelectorProps {
  jobs: JobInfo[];
  selectedJobNumber: string | null;
  onJobSelect: (jobNumber: string, listNumber: string) => void;
  isLoading?: boolean;
}

export default function JobSelector({
  jobs,
  selectedJobNumber,
  onJobSelect,
  isLoading = false,
}: JobSelectorProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isListDropdownOpen, setIsListDropdownOpen] = useState(false);
  const [searchDropdownUp, setSearchDropdownUp] = useState(false);
  const [listDropdownUp, setListDropdownUp] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  const listButtonRef = useRef<HTMLButtonElement>(null);
  const listDropdownRef = useRef<HTMLDivElement>(null);

  // Filter jobs based on search term
  const filteredJobs = useMemo(() => {
    if (!searchTerm.trim()) {
      return jobs;
    }

    const term = searchTerm.toLowerCase();
    return jobs.filter(
      (job) =>
        job.jobNumber.toLowerCase().includes(term) ||
        job.jobName.toLowerCase().includes(term),
    );
  }, [jobs, searchTerm]);

  const selectedJob = jobs.find((j) => j.jobNumber === selectedJobNumber);

  const handleJobClick = (jobNumber: string) => {
    const job = jobs.find((j) => j.jobNumber === jobNumber);
    const firstList = job?.listNumbers?.[0] ?? "1";
    onJobSelect(jobNumber, firstList);
    setIsDropdownOpen(false);
    setSearchTerm("");
  };

  // Check if dropdown should open upward
  const checkDropdownPosition = (
    buttonRef: React.RefObject<HTMLElement>,
    dropdownRef: React.RefObject<HTMLElement>,
    setIsUp: (up: boolean) => void,
  ) => {
    if (!buttonRef.current) return;

    const buttonRect = buttonRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - buttonRect.bottom;
    const spaceAbove = buttonRect.top;
    const dropdownHeight = 320; // max-h-80 = 20rem = 320px

    // If not enough space below but enough space above, open upward
    // Also consider a buffer zone (e.g., 50px) to avoid edge cases
    const buffer = 50;
    setIsUp(
      spaceBelow < dropdownHeight + buffer &&
        spaceAbove >= dropdownHeight + buffer,
    );
  };

  const handleSearchFocus = () => {
    setIsDropdownOpen(true);
    // Check position immediately and after DOM updates
    requestAnimationFrame(() => {
      checkDropdownPosition(
        searchInputRef,
        searchDropdownRef,
        setSearchDropdownUp,
      );
      // Double-check after a brief delay to ensure accurate positioning
      setTimeout(() => {
        checkDropdownPosition(
          searchInputRef,
          searchDropdownRef,
          setSearchDropdownUp,
        );
      }, 50);
    });
  };

  const handleSearchBlur = () => {
    // Delay to allow clicking on dropdown items
    setTimeout(() => setIsDropdownOpen(false), 200);
  };

  const handleListDropdownToggle = () => {
    const newState = !isListDropdownOpen;
    setIsListDropdownOpen(newState);
    if (newState) {
      // Check position immediately and after DOM updates
      requestAnimationFrame(() => {
        checkDropdownPosition(
          listButtonRef,
          listDropdownRef,
          setListDropdownUp,
        );
        // Double-check after a brief delay to ensure accurate positioning
        setTimeout(() => {
          checkDropdownPosition(
            listButtonRef,
            listDropdownRef,
            setListDropdownUp,
          );
        }, 50);
      });
    }
  };

  // Update dropdown position when window is resized or scrolled (throttled with RAF)
  useEffect(() => {
    let rafId: number | null = null;

    const updatePositions = () => {
      // Cancel previous RAF if pending
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }

      rafId = requestAnimationFrame(() => {
        if (isDropdownOpen) {
          checkDropdownPosition(
            searchInputRef,
            searchDropdownRef,
            setSearchDropdownUp,
          );
        }
        if (isListDropdownOpen) {
          checkDropdownPosition(
            listButtonRef,
            listDropdownRef,
            setListDropdownUp,
          );
        }
      });
    };

    window.addEventListener("resize", updatePositions);
    window.addEventListener("scroll", updatePositions, { passive: true });

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      window.removeEventListener("resize", updatePositions);
      window.removeEventListener("scroll", updatePositions);
    };
  }, [isDropdownOpen, isListDropdownOpen]);

  // Dynamic z-index: prioritize based on which dropdown opens upward
  // If both open upward, give the one that opens upward higher z-index
  // If both open downward, give search higher z-index (it's above in the DOM)
  // If one opens upward and one downward, give the upward one higher z-index
  const zIndexValues = useMemo(() => {
    const base = 10000;

    // If search dropdown opens upward, it should have higher z-index to appear above
    if (searchDropdownUp && !listDropdownUp) {
      // Search opens upward, list opens downward
      return {
        searchSection: base + 5,
        searchInner: base + 6,
        searchDropdown: base + 7,
        listSection: base,
        listInner: base + 1,
        listDropdown: base + 2,
      };
    } else if (!searchDropdownUp && listDropdownUp) {
      // Search opens downward, list opens upward
      return {
        searchSection: base,
        searchInner: base + 1,
        searchDropdown: base + 2,
        listSection: base + 5,
        listInner: base + 6,
        listDropdown: base + 7,
      };
    } else if (searchDropdownUp && listDropdownUp) {
      // Both open upward - list is below search in DOM, so give it higher z-index
      return {
        searchSection: base,
        searchInner: base + 1,
        searchDropdown: base + 2,
        listSection: base + 5,
        listInner: base + 6,
        listDropdown: base + 7,
      };
    } else {
      // Both open downward - search is above in DOM, give it higher z-index
      return {
        searchSection: base + 5,
        searchInner: base + 6,
        searchDropdown: base + 7,
        listSection: base,
        listInner: base + 1,
        listDropdown: base + 2,
      };
    }
  }, [searchDropdownUp, listDropdownUp]);

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="relative" style={{ zIndex: zIndexValues.searchSection }}>
        <label
          htmlFor="job-search"
          className="mb-2 sm:mb-3 block text-xs sm:text-sm font-bold text-slate-600 dark:text-slate-300"
        >
          Search Job
        </label>
        <div className="relative" style={{ zIndex: zIndexValues.searchInner }}>
          <div className="relative">
            <input
              ref={searchInputRef}
              id="job-search"
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onFocus={handleSearchFocus}
              onBlur={handleSearchBlur}
              placeholder="Search by job number or name..."
              disabled={isLoading}
              className="w-full pl-10 sm:pl-11 pr-3.5 sm:pr-4 py-2.5 sm:py-3 text-sm sm:text-base bg-white dark:bg-slate-800/80 border-2 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white rounded-xl font-medium focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:focus:border-blue-500/80 disabled:cursor-not-allowed transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500 shadow-sm"
            />
            <svg
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-slate-500 dark:text-slate-400 pointer-events-none sm:left-3.5 sm:h-5 sm:w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>

          {/* Dropdown */}
          {isDropdownOpen && filteredJobs.length > 0 && (
            <div
              ref={searchDropdownRef}
              className={`absolute w-full bg-white dark:bg-slate-800 backdrop-blur-xl border border-gray-200 dark:border-slate-700/60 rounded-xl shadow-2xl max-h-80 overflow-y-auto ring-1 ring-gray-200 dark:ring-slate-700/20 ${searchDropdownUp ? "bottom-full mb-2" : "top-full mt-2"}`}
              style={{ zIndex: zIndexValues.searchDropdown }}
            >
              {filteredJobs.map((job) => (
                <button
                  key={job.jobNumber}
                  onClick={() => handleJobClick(job.jobNumber)}
                  className={`w-full text-left px-3.5 py-2.5 sm:px-4 sm:py-3 hover:bg-slate-100 dark:hover:bg-slate-700/60 border-b border-slate-200 dark:border-slate-700/40 last:border-b-0 transition-all first:rounded-t-xl last:rounded-b-xl ${
                    selectedJobNumber === job.jobNumber
                      ? "bg-blue-600/70 text-white shadow-inner"
                      : "text-slate-900 dark:text-white hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <div className="font-bold text-sm sm:text-base">
                    {job.jobNumber}
                  </div>
                  <div
                    className={`mt-0.5 truncate text-xs sm:text-sm ${selectedJobNumber === job.jobNumber ? "text-white/95" : "text-slate-600 dark:text-slate-300"}`}
                  >
                    {job.jobName}
                  </div>
                  <div
                    className={`mt-1 flex items-center gap-2 text-[11px] sm:text-xs font-medium ${selectedJobNumber === job.jobNumber ? "text-white/85" : "text-slate-500 dark:text-slate-400"}`}
                  >
                    <span>
                      {job.lineCount === 0 ? 0 : job.pulledCount} / {job.lineCount}{" "}
                      items pulled
                    </span>
                    {(job.listNumbers?.length ?? 1) > 1 && (
                      <span className="bg-amber-500/20 dark:bg-amber-700/50 px-2 py-0.5 rounded-lg font-semibold">
                        {job.listNumbers!.length} lists
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* No results */}
          {isDropdownOpen && searchTerm && filteredJobs.length === 0 && (
            <div
              className={`absolute w-full bg-white dark:bg-slate-800 backdrop-blur-xl border border-gray-200 dark:border-slate-700/60 rounded-xl shadow-2xl p-3 sm:p-4 text-center ring-1 ring-gray-200 dark:ring-slate-700/20 ${searchDropdownUp ? "bottom-full mb-2" : "top-full mt-2"}`}
              style={{ zIndex: zIndexValues.searchDropdown }}
            >
              <p className="text-slate-600 dark:text-slate-400 font-medium">
                No jobs found matching "{searchTerm}"
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Selected Job Display */}
      {selectedJob && (
        <div
          className="bg-blue-600/20 dark:bg-blue-700/50 text-blue-900 dark:text-white rounded-xl p-4 sm:p-5 shadow-xl border border-blue-400/50 dark:border-blue-600/50 relative"
          style={{ zIndex: 1 }}
        >
          <div className="mb-1.5 sm:mb-2 text-[11px] sm:text-xs text-blue-700/90 dark:text-white/80 font-semibold uppercase tracking-wide">
            Selected Job
          </div>
          <div className="font-bold text-lg sm:text-xl">{selectedJob.jobNumber}</div>
          <div className="mt-1.5 sm:mt-2 text-xs sm:text-sm text-blue-800/90 dark:text-white/90 font-medium">
            {selectedJob.jobName}
          </div>
          <div className="mt-2.5 sm:mt-3 flex items-center gap-2 text-[11px] sm:text-xs text-blue-700/80 dark:text-white/70">
            <span className="bg-blue-500/20 dark:bg-white/20 px-2 py-1 rounded-lg font-semibold">
              {selectedJob.lineCount} items
            </span>
            <span className="bg-green-600/30 dark:bg-green-700/50 px-2 py-1 rounded-lg font-semibold">
              {selectedJob.lineCount === 0 ? 0 : selectedJob.pulledCount} pulled
            </span>
          </div>
        </div>
      )}

      {/* Quick access dropdown for all jobs */}
      <div className="relative" style={{ zIndex: zIndexValues.listSection }}>
        <label
          htmlFor="job-select"
          className="mb-2 sm:mb-3 block text-xs sm:text-sm font-bold text-slate-600 dark:text-slate-300"
        >
          Or select from list
        </label>
        <div className="relative" style={{ zIndex: zIndexValues.listInner }}>
          <button
            ref={listButtonRef}
            id="job-select"
            type="button"
            onClick={handleListDropdownToggle}
            onBlur={() => setTimeout(() => setIsListDropdownOpen(false), 200)}
            disabled={isLoading}
            className="w-full px-3.5 sm:px-4 py-2.5 sm:py-3 pr-9 sm:pr-10 text-sm sm:text-base bg-white dark:bg-slate-800/80 border-2 border-slate-300 dark:border-slate-600/80 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:focus:border-blue-500/80 disabled:bg-slate-200 dark:disabled:bg-slate-700/30 disabled:cursor-not-allowed transition-all font-medium text-slate-900 dark:text-white shadow-sm hover:border-slate-400 dark:hover:border-slate-500/80 text-left flex items-center justify-between"
          >
            <span
              className={selectedJobNumber ? "text-slate-900 dark:text-white" : "text-slate-500 dark:text-slate-400"}
            >
              {selectedJobNumber
                ? `${selectedJobNumber} — ${jobs.find((j) => j.jobNumber === selectedJobNumber)?.jobName || ""}`
                : "-- Select a job --"}
            </span>
            <svg
              className={`h-4 w-4 sm:h-5 sm:w-5 text-slate-500 dark:text-slate-400 transition-transform ${isListDropdownOpen ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          {/* Custom dropdown list with internal scroll */}
          {isListDropdownOpen && (
            <div
              ref={listDropdownRef}
              className={`absolute w-full bg-white dark:bg-slate-800 backdrop-blur-xl border border-gray-200 dark:border-slate-700/60 rounded-xl shadow-2xl max-h-80 overflow-y-auto ring-1 ring-gray-200 dark:ring-slate-700/20 ${listDropdownUp ? "bottom-full mb-2" : "top-full mt-2"}`}
              style={{ zIndex: zIndexValues.listDropdown }}
            >
              {jobs.map((job) => (
                <button
                  key={job.jobNumber}
                  onClick={() => handleJobClick(job.jobNumber)}
                  className={`w-full text-left px-3.5 py-2.5 sm:px-4 sm:py-3 hover:bg-gray-50 dark:hover:bg-slate-700/60 border-b border-gray-200 dark:border-slate-700/40 last:border-b-0 transition-all last:rounded-b-xl ${
                    selectedJobNumber === job.jobNumber
                      ? "bg-blue-600/70 text-white shadow-inner"
                      : "text-slate-900 dark:text-white hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <div className="font-bold text-sm sm:text-base">
                    {job.jobNumber}
                  </div>
                  <div
                    className={`mt-0.5 truncate text-xs sm:text-sm ${selectedJobNumber === job.jobNumber ? "text-white/95" : "text-slate-600 dark:text-slate-300"}`}
                  >
                    {job.jobName}
                  </div>
                  <div
                    className={`mt-1 flex items-center gap-2 text-[11px] sm:text-xs font-medium ${selectedJobNumber === job.jobNumber ? "text-white/85" : "text-slate-500 dark:text-slate-400"}`}
                  >
                    <span>
                      {job.lineCount === 0 ? 0 : job.pulledCount} / {job.lineCount}{" "}
                      items pulled
                    </span>
                    {(job.listNumbers?.length ?? 1) > 1 && (
                      <span className="bg-amber-500/20 dark:bg-amber-700/50 px-2 py-0.5 rounded-lg font-semibold">
                        {job.listNumbers!.length} lists
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
