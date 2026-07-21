// src/app/admin/(shell)/travel/loading.tsx
/**
 * @description Travel-blocks loading skeleton. Matches the real page shape -
 * heading + description with the Recalculate action, then the block list in a
 * card - rather than the generic list skeleton's filter-chip row (this page has
 * no filters).
 */

import { Bone } from "@/shared/components/Skeleton";
import type React from "react";

/**
 * Travel-blocks loading skeleton.
 * @returns Skeleton element.
 */
export default function TravelLoading(): React.ReactElement {
  return (
    <div role="status" aria-live="polite" aria-label="Loading travel blocks">
      {/* Heading + description, with the Recalculate action on the right. */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Bone className="mb-2 h-8 w-44 bg-admin-border" />
          <Bone className="h-4 w-80 max-w-full bg-admin-border opacity-60" />
        </div>
        <Bone className="h-9 w-32 bg-admin-border" />
      </div>

      {/* Block list. */}
      <div className="rounded-xl border border-admin-border bg-admin-surface p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Bone className="mb-2 h-4 w-56 max-w-full bg-admin-border" />
                <Bone className="h-3 w-40 max-w-full bg-admin-border opacity-60" />
              </div>
              <Bone className="h-6 w-16 shrink-0 bg-admin-border" />
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">Loading...</span>
    </div>
  );
}
