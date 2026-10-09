"use client";
// src/features/social/components/PostPaneTabs.tsx
// The Write / Preview switch the composer shows below xl, where the form and the preview
// don't fit side by side. It sticks under the admin top bar while the page scrolls.

import { cn } from "@/shared/lib/cn";
import type React from "react";

/** Which half of the composer is showing below xl. */
export type ComposerPane = "write" | "preview";

/**
 * Write / Preview switch.
 * @param props - Component props.
 * @param props.pane - The pane showing.
 * @param props.onSwitch - Shows the other pane.
 * @param props.blockedCount - How many things block posting, badged on Preview.
 * @returns Tab list element.
 */
export function PostPaneTabs({
  pane,
  onSwitch,
  blockedCount,
}: {
  pane: ComposerPane;
  onSwitch: (next: ComposerPane) => void;
  blockedCount: number;
}): React.ReactElement {
  return (
    <div
      role="tablist"
      aria-label="Show"
      className="sticky top-16 z-20 grid grid-cols-2 gap-1 rounded-lg border border-admin-border bg-admin-surface p-1 shadow-sm lg:top-18 xl:hidden"
    >
      {(["write", "preview"] as const).map((k) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={pane === k}
          onClick={() => onSwitch(k)}
          className={cn(
            "inline-flex h-10 items-center justify-center gap-2 rounded-md text-[0.9375rem] font-semibold transition-colors",
            pane === k
              ? "bg-russian-violet text-white"
              : "text-admin-muted hover:bg-admin-bg hover:text-admin-text",
          )}
        >
          {k === "write" ? "Write" : "Preview"}
          {k === "preview" && blockedCount > 0 && (
            <span
              className={cn(
                "rounded-full px-1.5 text-sm leading-5",
                pane === k ? "bg-admin-surface text-red-700" : "bg-red-600 text-white",
              )}
            >
              {blockedCount}
              <span className="sr-only"> to fix</span>
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
