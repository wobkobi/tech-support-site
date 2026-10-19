"use client";
// src/features/admin/components/ScheduleAutoRefresh.tsx
// Polls a calendar fingerprint and calls router.refresh() only when it changes, since an
// unconditional refresh re-renders the seven-week grid. Pauses while the tab is hidden.
// Travel minutes aren't fingerprinted; they ride along on the next calendar refresh.

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
  // A ref so the poll doesn't re-subscribe on every server render.
  const seenToken = useRef(token);
  useEffect(() => {
    seenToken.current = token;
  }, [token]);

  /** Fetches the current fingerprint and refreshes only if it moved. */
  const check = useCallback(async (): Promise<void> => {
    // The seen token lets the endpoint bust the schedule cache only on a real change.
    const query = new URLSearchParams({ from: fromIso, to: toIso, token: seenToken.current });
    try {
      const res = await fetch(`/api/admin/schedule/version?${query}`, { cache: "no-store" });
      if (!res.ok) return;
      const data: unknown = await res.json();
      const next = (data as { token?: unknown }).token;
      if (typeof next !== "string" || next === seenToken.current) return;
      // Don't stamp seenToken: the new render supplies it, so a lost refresh retries.
      router.refresh();
    } catch {
      // Offline or transient failure: retry on the next tick.
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
