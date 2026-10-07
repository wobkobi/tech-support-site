"use client";
// src/features/business/components/GetEstimateButton.tsx
// The "Get a rough estimate" CTA on the pricing page. Smooth-scrolls to the estimator
// section instead of a hard anchor jump, which would land the heading under the sticky
// navbar (the `scroll-mt-*` on the target keeps it clear of the navbar).

import { Button } from "@/shared/components/Button";
import type React from "react";
import { FaCaretDown } from "react-icons/fa6";

/**
 * Scrolls smoothly down to the `#estimate` section (its scroll margin clears the sticky header).
 * @returns The CTA button element.
 */
export function GetEstimateButton(): React.ReactElement {
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() =>
        document.getElementById("estimate")?.scrollIntoView({ behavior: "smooth", block: "start" })
      }
    >
      Get a rough estimate
      <FaCaretDown className="h-4 w-4" aria-hidden />
    </Button>
  );
}
