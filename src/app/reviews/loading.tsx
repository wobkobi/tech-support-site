// src/app/reviews/loading.tsx
/**
 * @file loading.tsx
 * @description Streaming skeleton for the reviews page: a heading card, a
 * two-column grid of review-card placeholders and the leave-a-review card.
 * Shown while the approved-reviews query runs.
 */

import { CARD, FrostedSection, PageShell } from "@/shared/components/PageLayout";
import { Bone } from "@/shared/components/Skeleton";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/**
 * Reviews route-loading skeleton.
 * @returns Skeleton element.
 */
export default function ReviewsLoading(): React.ReactElement {
  return (
    <PageShell>
      <FrostedSection>
        <div
          className="flex flex-col gap-6 sm:gap-8"
          role="status"
          aria-live="polite"
          aria-label="Loading reviews page"
        >
          {/* Heading card */}
          <section className={cn(CARD)}>
            <Bone className="mb-4 h-9 w-72 sm:h-10" />
            <Bone className="h-6 w-64 max-w-full" />
          </section>

          {/* Review card grid */}
          <section>
            <ul className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <li
                  key={i}
                  className="flex flex-col rounded-lg border-2 border-seasalt-400/60 bg-seasalt-800/80 p-4 sm:p-5"
                >
                  <Bone className="mb-2 h-5 w-full" />
                  <Bone className="mb-2 h-5 w-full" />
                  <Bone className="mb-4 h-5 w-2/3" />
                  <Bone className="ml-auto h-5 w-32" />
                </li>
              ))}
            </ul>
          </section>

          {/* Leave a review */}
          <section className={cn(CARD)}>
            <Bone className="h-5 w-full max-w-lg" />
          </section>

          <span className="sr-only">Loading reviews page...</span>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
