"use client";
// src/features/admin/hooks/use-now-minute.ts
// The current time to the minute, for the schedule's "now" line and marker. It's null on the
// server and while the page hydrates, so a minute ticking over between the server render and the
// browser can't make the markup differ (React error 418).

import { useSyncExternalStore } from "react";

const MINUTE_MS = 60_000;
/** How often the clock is re-read; the value only changes when the minute does. */
const READ_EVERY_MS = 5_000;

/**
 * Re-reads the clock on a timer.
 * @param onChange - React's callback to read the snapshot again.
 * @returns Stops the timer.
 */
function subscribe(onChange: () => void): () => void {
  const id = setInterval(onChange, READ_EVERY_MS);
  return () => clearInterval(id);
}

/**
 * The start of the current minute. Flooring keeps every read within a minute equal, which
 * useSyncExternalStore needs to avoid re-rendering on each read.
 * @returns Milliseconds since the epoch at the start of this minute.
 */
function readMinute(): number {
  return Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
}

/**
 * The current time floored to the minute, kept up to date in the browser.
 * @returns Milliseconds since the epoch at the start of this minute, or null on the server and
 *   during hydration.
 */
export function useNowMinute(): number | null {
  return useSyncExternalStore(subscribe, readMinute, () => null);
}
