// src/features/admin/components/ui/StatusPill.tsx
// Tone-mapped status badge for admin lists and detail views,
// replacing the ad-hoc per-view pill colour maps with one vocabulary:
// DRAFT = neutral, SENT = info, PAID = success, OVERDUE = critical,
// VOIDED = violet. Server-safe (no client hooks).

import { cn } from "@/shared/lib/cn";
import type React from "react";

/** Visual tone of a {@link StatusPill}. */
export type StatusTone = "neutral" | "info" | "success" | "warning" | "critical" | "violet";

/**
 * Light-tint background + dark text for each tone, from the public palette where one
 * fits. Critical uses the brand coquelicot; violet uses the #5a2a82 that matches the
 * PDF VOID watermark.
 * @param tone - The pill tone.
 * @returns Class string.
 */
function toneClasses(tone: StatusTone): string {
  switch (tone) {
    case "neutral":
      return "bg-seasalt-100 text-seasalt-800";
    case "info":
      return "bg-moonstone-100 text-moonstone-800";
    case "success":
      return "bg-green-100 text-green-800";
    case "warning":
      return "bg-amber-100 text-amber-900";
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
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-bold whitespace-nowrap",
        toneClasses(tone),
        className,
      )}
    >
      {children}
    </span>
  );
}
