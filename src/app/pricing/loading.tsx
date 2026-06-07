// src/app/pricing/loading.tsx
/**
 * @file loading.tsx
 * @description Streaming skeleton for the pricing page: heading card, a rate
 * card, the "no surprises" + accordion details card, and the closing
 * next-steps and estimate cards. Shown while the live pricing policy loads.
 */

import type React from "react";
import { cn } from "@/shared/lib/cn";
import { FrostedSection, PageShell, CARD } from "@/shared/components/PageLayout";
import { Bone } from "@/shared/components/Skeleton";

/**
 * Pricing route-loading skeleton.
 * @returns Skeleton element.
 */
export default function PricingLoading(): React.ReactElement {
  return (
    <PageShell>
      <FrostedSection>
        <div
          className={cn("flex flex-col gap-6 sm:gap-8")}
          role="status"
          aria-live="polite"
          aria-label="Loading pricing page"
        >
          {/* Heading card */}
          <section className={cn(CARD)}>
            <Bone className={cn("mb-4 h-9 w-72 sm:h-10")} />
            <Bone className={cn("h-6 w-full max-w-xl")} />
          </section>

          {/* Rate card */}
          <section className={cn(CARD)}>
            <Bone className={cn("mb-4 h-7 w-48")} />
            <div className={cn("flex flex-wrap items-end gap-3")}>
              <Bone className={cn("h-12 w-28")} />
              <Bone className={cn("h-6 w-40")} />
            </div>
          </section>

          {/* No surprises + accordion details */}
          <section className={cn(CARD)}>
            <Bone className={cn("mb-4 h-7 w-44")} />
            <div className={cn("mb-5 flex flex-col gap-3")}>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className={cn("flex gap-3")}>
                  <Bone className={cn("mt-1 size-4 shrink-0 rounded-full")} />
                  <Bone className={cn("h-5 max-w-lg flex-1")} />
                </div>
              ))}
            </div>
            <Bone className={cn("mb-3 h-6 w-36")} />
            <div className={cn("space-y-3")}>
              {Array.from({ length: 7 }).map((_, i) => (
                <div
                  className={cn(
                    "border-seasalt-400/80 bg-seasalt-900/60 flex items-center justify-between gap-3 rounded-xl border p-3 sm:p-4",
                  )}
                  key={i}
                >
                  <Bone className={cn("h-5 w-40")} />
                  <Bone className={cn("size-4 shrink-0 rounded-full")} />
                </div>
              ))}
            </div>
          </section>

          {/* Next steps */}
          <section className={cn(CARD)}>
            <Bone className={cn("h-6 w-full max-w-lg")} />
          </section>

          {/* Estimate */}
          <section className={cn(CARD)}>
            <Bone className={cn("mb-2 h-7 w-56")} />
            <Bone className={cn("h-5 w-full max-w-md")} />
          </section>

          <span className={cn("sr-only")}>Loading pricing page...</span>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
