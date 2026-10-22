"use client";
// src/features/social/components/useLibraryLayout.ts
// The Content library's remembered layout (cards or a table). useSyncExternalStore renders
// cards on the server and hydration, then the stored choice, with no mismatch.

import { useSyncExternalStore } from "react";

export type LibraryLayout = "grid" | "list";

const KEY = "social:contentView";

const listeners = new Set<() => void>();
/** Fallback when storage throws (private window, blocked site data). */
let memory: LibraryLayout = "grid";

/**
 * Reads the stored choice.
 * @returns The stored layout, or cards.
 */
function read(): LibraryLayout {
  try {
    const stored = window.localStorage.getItem(KEY);
    return stored === "grid" || stored === "list" ? stored : memory;
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
 * The remembered library layout.
 * @returns The current layout and a setter that remembers the pick.
 */
export function useLibraryLayout(): [LibraryLayout, (layout: LibraryLayout) => void] {
  const layout = useSyncExternalStore(subscribe, read, () => "grid" as const);

  /**
   * Switches layout and remembers it.
   * @param next - The picked layout.
   */
  function set(next: LibraryLayout): void {
    memory = next;
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // Storage blocked: the in-memory value still switches the layout for this visit.
    }
    for (const listener of listeners) listener();
  }

  return [layout, set];
}
