// src/app/booking/loading.tsx
/**
 * @file loading.tsx
 * @description Skeleton shown during navigation to /booking.
 */

import type React from "react";
import { cn } from "@/shared/lib/cn";
import { FrostedSection, PageShell, CARD } from "@/shared/components/PageLayout";

const SKELETON = cn("bg-seasalt-900/40 animate-pulse rounded-lg");

/**
 * Booking route-loading skeleton.
 * @returns Skeleton element.
 */
export default function BookingLoading(): React.ReactElement {
  return (
    <PageShell>
      <FrostedSection maxWidth="90rem">
        <div className={cn("flex flex-col gap-6 sm:gap-8")}>
          {/* Header card */}
          <section className={cn(CARD)}>
            <div className={cn(SKELETON, "mb-3 h-8 w-72")} />
            <div className={cn(SKELETON, "h-5 w-full max-w-xl")} />
          </section>

          {/* Two-column placeholder matching the live form layout. */}
          <div className={cn("grid gap-6 sm:gap-8 lg:grid-cols-[1fr_20rem]")}>
            <section
              className={cn(CARD, "order-2 lg:order-1")}
              role="status"
              aria-live="polite"
              aria-label="Loading booking form"
            >
              <div className={cn("flex flex-col gap-6")}>
                <div className={cn(SKELETON, "h-7 w-32")} />
                <div className={cn("flex flex-col gap-2")}>
                  <div className={cn(SKELETON, "h-5 w-48")} />
                  <div className={cn("flex gap-2")}>
                    <div className={cn(SKELETON, "h-12 flex-1")} />
                    <div className={cn(SKELETON, "h-12 flex-1")} />
                  </div>
                </div>
                <div className={cn("flex flex-col gap-2")}>
                  <div className={cn(SKELETON, "h-5 w-40")} />
                  <div className={cn("grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2")}>
                    <div className={cn(SKELETON, "h-11")} />
                    <div className={cn(SKELETON, "h-11")} />
                    <div className={cn(SKELETON, "h-11")} />
                    <div className={cn(SKELETON, "h-11")} />
                  </div>
                </div>
                <hr className={cn("border-seasalt-400/80")} />
                <div className={cn(SKELETON, "h-5 w-56")} />
                <div className={cn(SKELETON, "h-28")} />
                <div className={cn(SKELETON, "h-12 w-44")} />
              </div>
              <span className={cn("sr-only")}>Loading booking page...</span>
            </section>

            <aside className={cn("order-1 flex flex-col gap-6 sm:gap-8 lg:order-2")}>
              <div className={cn(CARD)}>
                <div className={cn(SKELETON, "mb-4 h-7 w-40")} />
                <div className={cn("flex flex-col gap-3")}>
                  <div className={cn(SKELETON, "h-12")} />
                  <div className={cn(SKELETON, "h-12")} />
                  <div className={cn(SKELETON, "h-12")} />
                </div>
              </div>
            </aside>
          </div>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
