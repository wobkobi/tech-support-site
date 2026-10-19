"use client";
// src/features/mailing/components/blocks/useBodyMode.ts
// The email body's remembered tab (Blocks or Plain text). useSyncExternalStore renders
// Blocks on the server and hydration, then the stored choice, with no mismatch.

import { useSyncExternalStore } from "react";

export type BodyMode = "blocks" | "text";

const KEY = "mailing:bodyMode";

const listeners = new Set<() => void>();
/** Fallback when storage throws (private window, blocked site data). */
let memory: BodyMode = "blocks";

/**
 * Reads the stored choice.
 * @returns The stored tab, or Blocks.
 */
function read(): BodyMode {
  try {
    const stored = window.localStorage.getItem(KEY);
    return stored === "text" || stored === "blocks" ? stored : memory;
  } catch {
    return memory;
  }
}

/**
 * Subscribes to changes from this tab and from other tabs.
 * @param listener - Called on a change.
 * @returns Unsubscribe.
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  /**
   * Passes on another tab's change to the same key.
   * @param e - The storage event.
   */
  const onStorage = (e: StorageEvent): void => {
    if (e.key === KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * The remembered body tab.
 * @returns The current tab and a setter that remembers the pick.
 */
export function useBodyMode(): [BodyMode, (mode: BodyMode) => void] {
  const mode = useSyncExternalStore(subscribe, read, () => "blocks" as const);

  /**
   * Switches tab and remembers it.
   * @param next - The picked tab.
   */
  function set(next: BodyMode): void {
    memory = next;
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // Storage blocked: the in-memory value still switches the tab for this visit.
    }
    for (const listener of listeners) listener();
  }

  return [mode, set];
}
