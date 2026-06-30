"use client";
// src/features/business/components/GetEstimateButton.tsx
/**
 * @description The "Get a rough estimate" CTA on the pricing page. Smooth-scrolls
 * to the estimator section instead of a hard anchor jump, which would land the
 * heading under the sticky navbar (the `scroll-mt-*` on the target keeps it
 * clear of the navbar).
 */

import { cn } from "@/shared/lib/cn";
import type React from "react";
import { FaCaretDown } from "react-icons/fa6";

/**
 * Scrolls smoothly down to the `#estimate-heading` section.
 * @returns The CTA button element.
 */
export function GetEstimateButton(): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() =>
        document
          .getElementById("estimate-heading")
          ?.scrollIntoView({ behavior: "smooth", block: "start" })
      }
      className={cn(
        "mt-5 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white",
        "bg-russian-violet transition-colors hover:bg-russian-violet/90",
      )}
    >
      Get a rough estimate
      <FaCaretDown className="h-4 w-4" aria-hidden />
    </button>
  );
}
