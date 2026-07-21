// src/app/admin/(shell)/price-estimates/loading.tsx
/**
 * @description Price-estimates loading skeleton. Matches the real page shape -
 * heading + a three-up stat row + the estimate-log list - rather than the
 * generic list skeleton's filter-chip row (this page has stat cards, not chips).
 */

import { Bone } from "@/shared/components/Skeleton";
import type React from "react";

/**
 * Price-estimates list-view loading skeleton.
 * @returns Skeleton element.
 */
export default function PriceEstimatesLoading(): React.ReactElement {
  return (
    <div role="status" aria-live="polite" aria-label="Loading">
      {/* Page heading + Show-dev action. */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Bone className="mb-2 h-7 w-40 bg-admin-border" />
          <Bone className="h-3 w-64 max-w-full bg-admin-border opacity-60" />
        </div>
        <Bone className="h-7 w-24 rounded-full bg-admin-border" />
      </div>

      {/* Three-up stat row (Today / Last 7 days / Last 30 days). */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-admin-border bg-admin-surface p-4 shadow-sm"
          >
            <Bone className="mb-2 h-3 w-16 bg-admin-border opacity-60" />
            <Bone className="h-6 w-10 bg-admin-border" />
          </div>
        ))}
      </div>

      {/* Estimate-log list. */}
      <div className="rounded-xl border border-admin-border bg-admin-surface p-4 shadow-sm sm:p-6">
        <div className="divide-y divide-admin-border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="py-4 first:pt-0">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <Bone className="h-3 w-32 bg-admin-border opacity-60" />
                <Bone className="h-5 w-40 bg-admin-border" />
              </div>
              <Bone className="mb-2 h-4 w-3/4 max-w-full bg-admin-border" />
              <Bone className="h-3 w-1/2 max-w-full bg-admin-border opacity-60" />
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">Loading...</span>
    </div>
  );
}
