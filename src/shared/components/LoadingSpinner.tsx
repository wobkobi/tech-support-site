// src/shared/components/LoadingSpinner.tsx
// Spinning wheel every route loading.tsx shows while its page streams in, so public and
// admin routes load with the same indicator.

import { cn } from "@/shared/lib/cn";
import type React from "react";

/** Props for {@link LoadingSpinner}. */
interface LoadingSpinnerProps {
  /** What is loading, folded into the screen-reader text ("Loading {label}..."). */
  label: string;
  /** Sizing for the centring box, e.g. a min-height so the wheel sits mid-page. */
  className?: string;
}

/**
 * Centred spinning wheel with a live-region announcement. Reduced-motion users get a
 * slower spin rather than none, so the page still reads as loading.
 * @param props - Component props.
 * @param props.label - What is loading, for the screen-reader text.
 * @param props.className - Sizing for the centring box.
 * @returns Spinner element.
 */
export function LoadingSpinner({ label, className }: LoadingSpinnerProps): React.ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex items-center justify-center", className)}
    >
      <div
        aria-hidden
        className="size-12 animate-spin rounded-full border-4 border-russian-violet/20 border-t-russian-violet motion-reduce:animate-[spin_1.5s_linear_infinite]"
      />
      <span className="sr-only">{`Loading ${label}...`}</span>
    </div>
  );
}
