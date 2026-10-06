// src/shared/components/Notice.tsx
// Aside panel with a coloured left border: tips, warnings and confirmations.

import { cn } from "@/shared/lib/cn";
import type React from "react";

const TONES = {
  info: "border-moonstone-700",
  warn: "border-coquelicot-600",
  ok: "border-green-700",
} as const;

/**
 * Grey (or white, on a grey section) panel with a 4px left border.
 * @param props - Component props.
 * @param props.tone - Border colour: info, warn or ok.
 * @param props.onGrey - White fill so the panel shows on a seasalt section.
 * @param props.role - Live-region role for messages that appear after an action.
 * @param props.className - Extra classes.
 * @param props.children - Panel content.
 * @returns The panel element.
 */
export function Notice({
  tone = "info",
  onGrey = false,
  role,
  className,
  children,
}: {
  tone?: keyof typeof TONES;
  onGrey?: boolean;
  role?: "status" | "alert";
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      role={role}
      className={cn(
        "border-l-4 px-5 py-4 text-base",
        onGrey ? "bg-white" : "bg-seasalt",
        TONES[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}
