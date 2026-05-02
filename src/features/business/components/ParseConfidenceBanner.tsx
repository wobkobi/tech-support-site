"use client";

import type React from "react";
import { cn } from "@/shared/lib/cn";

interface ParseConfidenceBannerProps {
  confidence: "high" | "medium" | "low";
  warnings: string[];
  onDismiss: () => void;
}

const CONFIG = {
  high: {
    bg: "bg-green-50 border-green-200",
    text: "text-green-800",
    icon: "✓",
    message: "Looks good - review the details below",
  },
  medium: {
    bg: "bg-amber-50 border-amber-200",
    text: "text-amber-800",
    icon: "⚠",
    message: "Review suggested - some items were estimated",
  },
  low: {
    bg: "bg-red-50 border-red-200",
    text: "text-red-800",
    icon: "✕",
    message: "Needs review - rates were mostly guessed",
  },
};

/**
 * Dismissible banner showing AI parse confidence and any warnings.
 * @param props - Component props
 * @param props.confidence - Parse confidence level (high / medium / low)
 * @param props.warnings - List of warning strings from the parser
 * @param props.onDismiss - Callback fired when the banner is dismissed
 * @returns Confidence banner element
 */
export function ParseConfidenceBanner({
  confidence,
  warnings,
  onDismiss,
}: ParseConfidenceBannerProps): React.ReactElement {
  const { bg, text, icon, message } = CONFIG[confidence];

  return (
    <div className={cn("rounded-lg border px-4 py-3", bg)}>
      <div className={cn("flex items-start justify-between gap-2")}>
        <div className={cn("flex items-start gap-2")}>
          <span className={cn("mt-0.5 text-sm font-bold", text)}>{icon}</span>
          <p className={cn("text-sm font-medium", text)}>{message}</p>
        </div>
        <button
          onClick={onDismiss}
          className={cn("text-sm leading-none opacity-50 hover:opacity-80", text)}
        >
          &times;
        </button>
      </div>
      {warnings.length > 0 && (
        <ul className={cn("mt-2 space-y-0.5 pl-5 text-xs", text)}>
          {warnings.map((w, i) => (
            <li key={i} className="list-disc">
              {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
