"use client";
// src/features/admin/hooks/use-optimistic-day-blocks.ts
// Optimistic block/unblock state for schedule views, bridging Google's write lag and the
// 30s cache.

import type { WeekEvent } from "@/features/admin/lib/schedule-types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/** Debounce before refetching, long enough for rapid clicks to settle. */
const REFRESH_DEBOUNCE_MS = 1200;

/** State and actions returned by {@link useOptimisticDayBlocks}. */
interface UseOptimisticDayBlocks {
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
 * Tracks in-flight day blocks and their optimistic overrides. Refreshes are debounced
 * since each block busts the cache and re-hits Google. Fresh server data drops overrides
 * for days no longer in flight.
 * @param events - Server events; a new array is the signal to reconcile.
 * @returns Pending set, override map, and the three actions.
 */
export function useOptimisticDayBlocks(events: readonly WeekEvent[]): UseOptimisticDayBlocks {
  const router = useRouter();
  // Several days can be in flight; each button disables only its own day.
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

  // Don't refresh an unmounted view.
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
