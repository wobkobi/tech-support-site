"use client";
// src/features/admin/components/ScheduleAutoRefresh.tsx
/**
 * @description Keeps the admin schedule current without a manual reload, so
 * externally-made calendar changes (a new booking landing, or a block made
 * directly in Google Calendar) surface on their own. Each tick asks
 * `/api/admin/schedule/version` for a fingerprint of the rendered window and
 * only calls router.refresh() when it differs from the token the page was built
 * with; refreshing unconditionally would re-run a full server render of the
 * seven-week grid every tick. Polling pauses while the tab is hidden and checks
 * once on re-show so a backgrounded tab catches up. Rendered once by the
 * schedule page; router.refresh() preserves client state (open modals, form
 * input) so a refresh is non-disruptive.
 *
 * Travel-bar minutes are not part of the fingerprint: they are recomputed by the
 * travel cron and can lag a cycle behind their event either way, so they ride
 * along on the next calendar-driven refresh.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

/** Props for {@link ScheduleAutoRefresh}. */
interface ScheduleAutoRefreshProps {
  /** ISO start of the buffered window the page rendered. */
  fromIso: string;
  /** ISO end of the buffered window the page rendered. */
  toIso: string;
  /** Fingerprint of the events this render was built from. */
  token: string;
  /** Poll interval in milliseconds (defaults to 60s). */
  intervalMs?: number;
}

/**
 * Mounts a visibility-gated poll that refreshes the route only on real change.
 * @param props - Component props.
 * @param props.fromIso - ISO start of the buffered window the page rendered.
 * @param props.toIso - ISO end of the buffered window the page rendered.
 * @param props.token - Fingerprint of the events this render was built from.
 * @param props.intervalMs - Poll interval in ms (default 60000).
 * @returns Nothing rendered.
 */
export function ScheduleAutoRefresh({
  fromIso,
  toIso,
  token,
  intervalMs = 60_000,
}: ScheduleAutoRefreshProps): null {
  const router = useRouter();
  // Token the visible grid was built from. Kept in a ref so the polling effect
  // doesn't tear down and re-subscribe on every server render.
  const seenToken = useRef(token);
  useEffect(() => {
    seenToken.current = token;
  }, [token]);

  /** Fetches the current fingerprint and refreshes only if it moved. */
  const check = useCallback(async (): Promise<void> => {
    const query = `from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`;
    try {
      const res = await fetch(`/api/admin/schedule/version?${query}`, { cache: "no-store" });
      if (!res.ok) return;
      const data: unknown = await res.json();
      const next = (data as { token?: unknown }).token;
      if (typeof next !== "string" || next === seenToken.current) return;
      // Deliberately not stamping seenToken here: the refreshed render supplies
      // the new token via props. If the refresh fails to land, the ref stays on
      // the old value and the next tick retries instead of silently giving up.
      router.refresh();
    } catch {
      // Offline or a transient upstream failure - keep the current view and
      // try again on the next tick.
    }
  }, [fromIso, toIso, router]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;

    /** Starts the interval if the tab is visible and one isn't already running. */
    function start(): void {
      if (timer || document.visibilityState !== "visible") return;
      timer = setInterval(() => void check(), intervalMs);
    }
    /** Stops the interval. */
    function stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    }
    /** Pause when hidden; on re-show, check once immediately then resume. */
    function onVisibility(): void {
      if (document.visibilityState === "visible") {
        void check();
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
  }, [check, intervalMs]);

  return null;
}
