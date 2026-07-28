"use client";
// src/features/admin/hooks/use-optimistic-day-blocks.ts
/**
 * @description Optimistic block/unblock state for the schedule views. Google
 * lags a write and the 30s cache can serve a stale read, so a plain refetch
 * shows the old state; this holds an override per day to bridge the gap and
 * coalesces the refetches that follow.
 */

import type { WeekEvent } from "@/features/admin/lib/schedule-types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/** Debounce before refetching, long enough for rapid clicks to settle. */
const REFRESH_DEBOUNCE_MS = 1200;

/** State and actions returned by {@link useOptimisticDayBlocks}. */
export interface UseOptimisticDayBlocks {
  /** Days with a block/unblock request in flight. */
  pendingDays: ReadonlySet<string>;
  /** Optimistic overrides per day (dateKey > blocked?). */
  optimisticBlock: ReadonlyMap<string, boolean>;
  /** Adds/removes a day from the in-flight set as its request starts/finishes. */
  setPending: (dayKey: string, pending: boolean) => void;
  /** Records the optimistic busy state for a just-clicked day. */
  applyOptimisticBlock: (dayKey: string, blocked: boolean) => void;
  /** Coalesces schedule refetches into one after rapid changes settle. */
  debouncedRefresh: () => void;
}

/**
 * Tracks in-flight day blocks and their optimistic overrides.
 *
 * Blocking several days fires one refresh, not one per click: each block busts
 * the 30s cache, so N immediate refreshes would each re-hit Google and back the
 * server up (locking out further clicks). The optimistic UI covers the interim.
 *
 * Overrides only bridge click > next refresh, so fresh server data drops the
 * overrides for days no longer in flight (a lost or merged block falls back to
 * its real state). Pending lives in a ref so reconciliation keys off server
 * data alone, not off a request settling.
 * @param events - Server events; a new array is the signal to reconcile.
 * @returns Pending set, override map, and the three actions.
 */
export function useOptimisticDayBlocks(events: readonly WeekEvent[]): UseOptimisticDayBlocks {
  const router = useRouter();
  // A Set so several days can be in flight at once (each button disables only
  // its own day, not the whole view).
  const [pendingDays, setPendingDays] = useState<Set<string>>(() => new Set());
  const [optimisticBlock, setOptimisticBlock] = useState<Map<string, boolean>>(() => new Map());

  const setPending = useCallback((dayKey: string, pending: boolean): void => {
    setPendingDays((prev) => {
      const next = new Set(prev);
      if (pending) next.add(dayKey);
      else next.delete(dayKey);
      return next;
    });
  }, []);

  const applyOptimisticBlock = useCallback((dayKey: string, blocked: boolean): void => {
    setOptimisticBlock((prev) => new Map(prev).set(dayKey, blocked));
  }, []);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedRefresh = useCallback((): void => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS);
  }, [router]);

  // Navigating away mid-debounce would otherwise fire router.refresh() against
  // an unmounted view.
  useEffect(() => {
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, []);

  const pendingRef = useRef(pendingDays);
  useEffect(() => {
    pendingRef.current = pendingDays;
  }, [pendingDays]);

  useEffect(() => {
    setOptimisticBlock((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Map(prev);
      for (const day of prev.keys()) {
        if (!pendingRef.current.has(day)) {
          next.delete(day);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [events]);

  return { pendingDays, optimisticBlock, setPending, applyOptimisticBlock, debouncedRefresh };
}
