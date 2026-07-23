// src/features/admin/components/ui/StatusPill.tsx
/**
 * @description Tone-mapped status badge for admin lists and detail views,
 * replacing the ad-hoc per-view pill colour maps with one vocabulary:
 * DRAFT = neutral, SENT = info, PAID = success, OVERDUE = critical,
 * VOIDED = violet. Server-safe (no client hooks).
 */

import { cn } from "@/shared/lib/cn";
import type React from "react";

/** Visual tone of a {@link StatusPill}. */
export type StatusTone = "neutral" | "info" | "success" | "warning" | "critical" | "violet";

/**
 * Light-tint background + saturated text for each tone. Critical uses the brand
 * coquelicot; violet uses the #5a2a82 that matches the PDF VOID watermark.
 * @param tone - The pill tone.
 * @returns Class string.
 */
function toneClasses(tone: StatusTone): string {
  switch (tone) {
    case "neutral":
      return "bg-slate-100 text-slate-600";
    case "info":
      return "bg-blue-100 text-blue-700";
    case "success":
      return "bg-emerald-100 text-emerald-700";
    case "warning":
      return "bg-amber-100 text-amber-800";
    case "critical":
      return "bg-coquelicot-100 text-coquelicot-700";
    case "violet":
      return "bg-[#5a2a82]/12 text-[#5a2a82]";
  }
}

/** Props for {@link StatusPill}. */
interface StatusPillProps {
  /** Visual tone. */
  tone: StatusTone;
  /** Pill label. */
  children: React.ReactNode;
  /** Extra classes. */
  className?: string;
}

/**
 * Renders a rounded status pill in the given tone.
 * @param props - Component props.
 * @param props.tone - Visual tone.
 * @param props.children - Pill label.
 * @param props.className - Extra classes.
 * @returns The pill element.
 */
export function StatusPill({ tone, children, className }: StatusPillProps): React.ReactElement {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        toneClasses(tone),
        className,
      )}
    >
      {children}
    </span>
  );
}
