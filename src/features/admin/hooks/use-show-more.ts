"use client";
// src/features/admin/hooks/use-show-more.ts
// Caps a long admin list at a first batch and grows it a batch at a time, so a phone
// doesn't render every record into one very long page.

import { useState } from "react";

/** State and actions returned by {@link useShowMore}. */
export interface UseShowMore<T> {
  /** The rows to render. */
  visible: T[];
  /** How many rows are still hidden. */
  remaining: number;
  /** Size of the next batch: the step, or what's left when that's fewer. */
  nextBatch: number;
  /** Reveals the next batch. */
  showMore: () => void;
}

/**
 * Shows the first `step` items, then `step` more on each call to `showMore`.
 *
 * The limit is stored against the `resetKey` it was grown under, and a
 * different key reads as the first batch again. So a new search, filter or
 * sort starts from the top of the list without an effect or a setState during
 * render.
 * @param items - The full (already filtered and sorted) list.
 * @param step - Rows per batch.
 * @param resetKey - Anything that changes when the list is re-filtered or re-sorted.
 * @returns The visible slice plus the show-more state.
 */
export function useShowMore<T>(items: readonly T[], step: number, resetKey = ""): UseShowMore<T> {
  const [grown, setGrown] = useState({ key: resetKey, limit: step });
  const limit = grown.key === resetKey ? grown.limit : step;
  const remaining = Math.max(0, items.length - limit);
  /** Grows the limit by one batch under the current key. */
  function showMore(): void {
    setGrown({ key: resetKey, limit: limit + step });
  }
  return {
    visible: items.slice(0, limit),
    remaining,
    nextBatch: Math.min(step, remaining),
    showMore,
  };
}
