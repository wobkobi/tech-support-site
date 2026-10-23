"use client";
// src/features/admin/hooks/use-visible-viewport.ts
// The part of the screen a phone's keyboard leaves showing. The keyboard only shrinks the visual
// viewport, so `fixed inset-0` and `dvh` still reach down behind it; a dialog sized to this stays
// above it instead.

import { useMemo, useSyncExternalStore } from "react";

/** The visible area in CSS pixels, measured from the top of the layout viewport. */
export interface VisibleViewport {
  top: number;
  height: number;
}

/**
 * Re-reads the visible area as the keyboard opens or closes, or the page pans under it.
 * @param onChange - React's callback to read the snapshot again.
 * @returns Stops listening.
 */
function subscribe(onChange: () => void): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  vv.addEventListener("resize", onChange);
  vv.addEventListener("scroll", onChange);
  return () => {
    vv.removeEventListener("resize", onChange);
    vv.removeEventListener("scroll", onChange);
  };
}

/**
 * Subscription for a dialog that's closed: nothing to follow.
 * @returns A no-op unsubscribe.
 */
function subscribeNone(): () => void {
  return () => {};
}

/**
 * The visible area as "top:height", or "" while nothing covers the page. A string keeps reads
 * equal between changes, which useSyncExternalStore needs to avoid re-rendering on each read.
 * @returns The snapshot.
 */
function readViewport(): string {
  const vv = window.visualViewport;
  // 1px of slack: some phones report a fractional height with nothing covering the page.
  if (!vv || vv.height >= window.innerHeight - 1) return "";
  return `${Math.round(vv.offsetTop)}:${Math.round(vv.height)}`;
}

/**
 * The visible area while a phone's keyboard (or a pinch zoom) covers part of the page.
 * @param active - Whether to follow it; a closed dialog doesn't need to.
 * @returns The visible area, or null when the whole page shows, on the server and while closed.
 */
export function useVisibleViewport(active: boolean): VisibleViewport | null {
  const snapshot = useSyncExternalStore(
    active ? subscribe : subscribeNone,
    active ? readViewport : () => "",
    () => "",
  );
  return useMemo(() => {
    if (!snapshot) return null;
    const [top, height] = snapshot.split(":").map(Number);
    return { top: top!, height: height! };
  }, [snapshot]);
}
