"use client";
// src/features/social-design/components/TipStrip.tsx
// First-open tips for the post maker. Dismissing it is remembered in this browser only;
// with storage blocked it simply shows again next time. The editor only ever renders in
// the browser (ssr: false), so storage can be read while rendering.

import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useState } from "react";
import { FaLightbulb, FaXmark } from "react-icons/fa6";

const KEY = "post-maker-tips-dismissed";

/**
 * Dismissible tip strip.
 * @param props - Component props.
 * @param props.className - Extra classes.
 * @returns Strip element, or null once dismissed.
 */
export function TipStrip({ className }: { className?: string }): React.ReactElement | null {
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem(KEY) !== "1";
    } catch {
      return true;
    }
  });
  if (!show) return null;
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border border-moonstone-300 bg-moonstone-50 px-3 py-2 text-sm text-admin-text",
        className,
      )}
    >
      <FaLightbulb aria-hidden className="mt-0.5 size-4 shrink-0 text-moonstone-700" />
      <p className="flex-1">
        Every change you make here shows on all the sizes at once: switch sizes from the size menu
        to check each one. Double-click words to type on the picture, drag across the picture to
        pick several things, and use Ctrl+Z to undo.
      </p>
      <button
        type="button"
        aria-label="Hide these tips"
        onClick={() => {
          setShow(false);
          try {
            localStorage.setItem(KEY, "1");
          } catch {
            // Storage blocked: the strip hides for this visit only.
          }
        }}
        className="shrink-0 rounded p-1 text-admin-muted hover:bg-moonstone-100"
      >
        <FaXmark aria-hidden className="size-4" />
      </button>
    </div>
  );
}
