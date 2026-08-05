"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { isDemoBannerEnabled } from "@/lib/featureFlags";

/**
 * Positioning banner pinned above every dashboard page during client walkthroughs.
 *
 * The page shells are full-height (`h-screen` / `min-h-screen`) flex layouts, so a
 * banner cannot simply be stacked above them — the content would run past the fold.
 * Instead this renders `fixed` at the top, publishes its measured height as
 * `--demo-banner-h`, and flags the body with `data-demo-banner`. globals.css uses
 * those two to offset the body and shrink the full-height utilities by exactly the
 * banner's height, so every existing page keeps its layout without being touched.
 *
 * Height is measured rather than hardcoded because the copy wraps to two or three
 * lines depending on viewport width.
 */

/** Routes that are not "the dashboard" — sign-in and location-picker chrome. */
const HIDDEN_PREFIXES = ["/login", "/auth", "/select"];

export default function DemoBanner() {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement | null>(null);

  const hidden =
    !isDemoBannerEnabled() ||
    HIDDEN_PREFIXES.some((p) => pathname === p || pathname?.startsWith(`${p}/`));

  // useLayoutEffect so the offset is applied before paint — otherwise the page
  // visibly jumps on first render.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const body = document.body;

    if (hidden) {
      body.removeAttribute("data-demo-banner");
      root.style.removeProperty("--demo-banner-h");
      return;
    }

    const el = ref.current;
    if (!el) return;

    const apply = () => {
      root.style.setProperty("--demo-banner-h", `${el.offsetHeight}px`);
      body.setAttribute("data-demo-banner", "true");
    };
    apply();

    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hidden]);

  // Clean up if the component unmounts entirely.
  useEffect(() => {
    return () => {
      document.body.removeAttribute("data-demo-banner");
      document.documentElement.style.removeProperty("--demo-banner-h");
    };
  }, []);

  if (hidden) return null;

  return (
    <div
      ref={ref}
      role="note"
      aria-label="Product positioning"
      className="fixed inset-x-0 top-0 z-[60] border-b border-blue-500/30 bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 text-white shadow-lg shadow-blue-950/20"
    >
      <div className="mx-auto flex max-w-[1600px] flex-col gap-1.5 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6">
        <p className="text-[13px] leading-snug sm:text-sm">
          <span className="font-bold text-white">One job record.</span>{" "}
          <span className="text-blue-100/90">
            Estimate, time cards, material receipts, photos, manager communication, invoice.
          </span>{" "}
          <span className="font-bold text-white underline decoration-blue-400 decoration-2 underline-offset-4">
            Entered once.
          </span>
        </p>
        <p className="shrink-0 text-[11px] font-medium uppercase tracking-[0.12em] text-blue-300/70 sm:text-right">
          A working template — we build on this to fit how your team works
        </p>
      </div>
    </div>
  );
}
