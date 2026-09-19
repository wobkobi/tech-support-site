"use client";
// src/features/admin/hooks/use-unsaved-changes-warning.ts

import { useEffect } from "react";

/**
 * Raises the browser's own "leave this page?" prompt on a reload, tab close or
 * external navigation while `dirty` is true. In-app links are client-side
 * navigations that never fire beforeunload, so they aren't covered.
 * @param dirty - Whether there are unsaved edits.
 */
export function useUnsavedChangesWarning(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    /**
     * Triggers the browser's native unsaved-changes prompt.
     * @param e - The beforeunload event.
     */
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
}
