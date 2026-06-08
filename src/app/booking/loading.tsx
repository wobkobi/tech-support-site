// src/app/booking/loading.tsx
/**
 * @file loading.tsx
 * @description Skeleton shown during navigation to /booking (and inherited by
 * /booking/edit, which reuses the same form).
 */

import { CARD, FrostedSection, PageShell } from "@/shared/components/PageLayout";
import { Bone } from "@/shared/components/Skeleton";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/**
 * Booking route-loading skeleton.
 * @returns Skeleton element.
 */
export default function BookingLoading(): React.ReactElement {
  return (
    <PageShell>
      <FrostedSection>
        <div className={cn("flex flex-col gap-6 sm:gap-8")}>
          {/* Header card */}
          <section className={cn(CARD)}>
            <Bone className={cn("mb-3 h-8 w-72")} />
            <Bone className={cn("h-5 w-full max-w-xl")} />
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
                <Bone className={cn("h-7 w-32")} />
                <div className={cn("flex flex-col gap-2")}>
                  <Bone className={cn("h-5 w-48")} />
                  <div className={cn("flex gap-2")}>
                    <Bone className={cn("h-12 flex-1")} />
                    <Bone className={cn("h-12 flex-1")} />
                  </div>
                </div>
                <div className={cn("flex flex-col gap-2")}>
                  <Bone className={cn("h-5 w-40")} />
                  <div className={cn("grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2")}>
                    <Bone className={cn("h-11")} />
                    <Bone className={cn("h-11")} />
                    <Bone className={cn("h-11")} />
                    <Bone className={cn("h-11")} />
                  </div>
                </div>
                <hr className={cn("border-seasalt-400/80")} />
                <Bone className={cn("h-5 w-56")} />
                <Bone className={cn("h-28")} />
                <Bone className={cn("h-12 w-44")} />
              </div>
              <span className={cn("sr-only")}>Loading booking page...</span>
            </section>

            <aside className={cn("order-1 flex flex-col gap-6 sm:gap-8 lg:order-2")}>
              <div className={cn(CARD)}>
                <Bone className={cn("mb-4 h-7 w-40")} />
                <div className={cn("flex flex-col gap-3")}>
                  <Bone className={cn("h-12")} />
                  <Bone className={cn("h-12")} />
                  <Bone className={cn("h-12")} />
                </div>
              </div>
            </aside>
          </div>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
