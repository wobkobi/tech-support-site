"use client";
// src/features/admin/components/ScheduleAutoRefresh.tsx
/**
 * @description Silently re-pulls the admin schedule on an interval so
 * externally-made calendar changes (a new booking landing, or a block made
 * directly in Google Calendar) appear without a manual reload. Pairs with the
 * 30s schedule cache: most ticks hit the cache (no Google call), and a tick past
 * the TTL triggers one refetch. Polling pauses while the tab is hidden to avoid
 * needless work, and fires once on re-show so a backgrounded tab catches up.
 * Rendered once by the schedule page; router.refresh() preserves client state
 * (open modals, form input) so a tick is non-disruptive.
 */

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Props for {@link ScheduleAutoRefresh}. */
interface ScheduleAutoRefreshProps {
  /** Poll interval in milliseconds (defaults to 30s, matching the cache TTL). */
  intervalMs?: number;
}

/**
 * Mounts a visibility-gated interval that refreshes the current route.
 * @param props - Component props.
 * @param props.intervalMs - Poll interval in ms (default 30000).
 * @returns Nothing rendered.
 */
export function ScheduleAutoRefresh({ intervalMs = 30_000 }: ScheduleAutoRefreshProps): null {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;

    /** Starts the interval if the tab is visible and one isn't already running. */
    function start(): void {
      if (timer || document.visibilityState !== "visible") return;
      timer = setInterval(() => router.refresh(), intervalMs);
    }
    /** Stops the interval. */
    function stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    }
    /** Pause when hidden; on re-show, refresh once immediately then resume. */
    function onVisibility(): void {
      if (document.visibilityState === "visible") {
        router.refresh();
        start();
      } else {
        stop();
      }
    }

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, intervalMs]);

  return null;
}
