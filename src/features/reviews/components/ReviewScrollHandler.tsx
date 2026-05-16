"use client";

import { useEffect } from "react";

const COQ = "243, 66, 19";

/**
 * Centers a hash-targeted review card in the viewport with a smooth scroll
 * starting from the top of the page, then plays a soft outer-glow halo on
 * arrival. Uses the Web Animations API so the flash isn't suppressed by the
 * global `prefers-reduced-motion` CSS override.
 * @returns Null (this component only runs side effects).
 */
export function ReviewScrollHandler(): null {
  useEffect(() => {
    /**
     * Locates the targeted review, jumps to top, smooth-scrolls to center it,
     * then triggers the halo flash. Retries briefly if DOM isn't ready.
     * @param attempt - Current retry count.
     */
    function flashTarget(attempt = 0): void {
      const rawHash = window.location.hash;
      const matches = rawHash.match(/review-[a-zA-Z0-9_-]+/g);
      // No hash target: undo any stale scroll-restoration and stay at the top.
      // Without this, clicking "Reviews" in the navbar after previously
      // targeting a review would scroll back to the old anchor.
      if (!matches || matches.length === 0) {
        window.scrollTo({ top: 0, behavior: "instant" });
        return;
      }
      const id = matches[matches.length - 1];

      if (matches.length > 1 || rawHash !== `#${id}`) {
        history.replaceState(null, "", `${window.location.pathname}#${id}`);
      }

      const el = document.getElementById(id);
      if (!el) {
        if (attempt < 20) setTimeout(() => flashTarget(attempt + 1), 100);
        return;
      }

      // Always start the journey from the top
      window.scrollTo({ top: 0, behavior: "instant" });

      // Brief beat so the user sees "we're at the top", then glide to target
      const target: HTMLElement = el;
      setTimeout(() => {
        target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });

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

        // Fire halo when smooth scroll finishes; fall back to a fixed delay
        // for browsers without `scrollend` support (older Safari).
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

    // Slight initial delay so the page has finished laying out
    const t = setTimeout(() => flashTarget(0), 150);
    /**
     * Re-runs the flash sequence when the URL hash changes within the page.
     */
    function onHashChange(): void {
      flashTarget(0);
    }
    window.addEventListener("hashchange", onHashChange);
    return () => {
      clearTimeout(t);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  return null;
}
