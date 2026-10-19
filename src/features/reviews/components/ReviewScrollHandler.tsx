"use client";
// src/features/reviews/components/ReviewScrollHandler.tsx
// Centres a hash-targeted review card with a smooth scroll from the top, then flashes a
// halo. Re-runs on hashchange; renders nothing.

import { useEffect } from "react";

const COQ = "243, 66, 19";

/**
 * Scrolls to and flashes the hash-targeted review. The Web Animations API keeps the
 * flash alive under the global `prefers-reduced-motion` CSS override.
 * @returns Null (this component only runs side effects).
 */
export function ReviewScrollHandler(): null {
  useEffect(() => {
    // A retry can fire up to 2s after unmount and would scroll the next page to the top.
    let cancelled = false;

    /**
     * Finds the targeted review, scrolls to it and flashes it; retries while it isn't in
     * the DOM yet.
     * @param attempt - Current retry count.
     */
    function flashTarget(attempt = 0): void {
      if (cancelled) return;
      const rawHash = window.location.hash;
      const matches = rawHash.match(/review-[a-zA-Z0-9_-]+/g);
      // No hash target: undo stale scroll restoration so the navbar link lands at the top.
      if (!matches || matches.length === 0) {
        window.scrollTo({ top: 0, behavior: "instant" });
        return;
      }
      const id = matches[matches.length - 1]!;

      if (matches.length > 1 || rawHash !== `#${id}`) {
        history.replaceState(null, "", `${window.location.pathname}#${id}`);
      }

      const el = document.getElementById(id);
      if (!el) {
        if (attempt < 20) setTimeout(() => flashTarget(attempt + 1), 100);
        return;
      }

      window.scrollTo({ top: 0, behavior: "instant" });

      // Brief beat at the top, then glide to the target.
      const target: HTMLElement = el;
      const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setTimeout(() => {
        target.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: prefersReduced ? "auto" : "smooth",
        });

        /**
         * Plays the halo flash on the targeted card.
         */
        function playHalo(): void {
          target.animate(
            [
              { boxShadow: `0 0 0 0 rgba(${COQ}, 0)` },
              { boxShadow: `0 0 28px 6px rgba(${COQ}, 0.7)`, offset: 0.25 },
              { boxShadow: `0 0 0 0 rgba(${COQ}, 0)` },
            ],
            { duration: 2200, easing: "ease-out", fill: "none" },
          );
        }

        // Fire on scrollend, with a fixed-delay fallback for older Safari.
        let fired = false;
        /**
         * Triggers the halo exactly once when the smooth scroll has settled.
         */
        function onScrollEnd(): void {
          if (fired) return;
          fired = true;
          window.removeEventListener("scrollend", onScrollEnd);
          playHalo();
        }
        window.addEventListener("scrollend", onScrollEnd);
        setTimeout(onScrollEnd, 1400);
      }, 200);
    }

    // Slight delay so the page has finished laying out.
    const t = setTimeout(() => flashTarget(0), 150);
    /**
     * Re-runs the flash sequence when the URL hash changes within the page.
     */
    function onHashChange(): void {
      flashTarget(0);
    }
    window.addEventListener("hashchange", onHashChange);
    return () => {
      cancelled = true;
      clearTimeout(t);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  return null;
}
