// src/app/booking/success/loading.tsx
/**
 * @description Streaming skeleton for the booking success page. Matches the
 * page's own frosted container (not PageShell) so it doesn't inherit the
 * booking-form skeleton: a centred confirmation card, a "what's next" card and
 * the cancellation-policy card.
 */

import { Bone } from "@/shared/components/Skeleton";
import { cn } from "@/shared/lib/cn";
import type React from "react";

const CARD = "border-seasalt-200/60 bg-white rounded-xl border p-5 shadow-sm sm:p-6";

/**
 * Booking success route-loading skeleton.
 * @returns Skeleton element.
 */
export default function BookingSuccessLoading(): React.ReactElement {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      {/* Backdrop */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <picture>
          <source type="image/avif" srcSet="/source/backdrop-blur.avif" />
          <img
            src="/source/backdrop-blur.webp"
            alt=""
            fetchPriority="high"
            decoding="async"
            className="absolute inset-0 h-full w-full scale-110 transform-gpu object-cover"
          />
        </picture>
      </div>

      {/* Frosted container */}
      <div className="mx-auto my-5 w-full max-w-[min(100vw-2rem,56rem)] sm:my-10">
        <div className="rounded-2xl border border-seasalt-200/40 bg-white/60 p-5 shadow-lg backdrop-blur-xl sm:p-10">
          <div
            className="flex flex-col gap-4 sm:gap-5"
            role="status"
            aria-live="polite"
            aria-label="Loading booking confirmation"
          >
            {/* Confirmation card */}
            <section className={cn(CARD, "flex flex-col items-center text-center")}>
              <Bone className="mb-4 size-16 rounded-full" />
              <Bone className="mb-3 h-9 w-64 max-w-full sm:h-10" />
              <Bone className="mb-2 h-5 w-full max-w-lg" />
              <Bone className="mb-6 h-5 w-3/4 max-w-md" />
              <div className="flex flex-wrap justify-center gap-3">
                <Bone className="h-9 w-32 rounded-xl" />
                <Bone className="h-9 w-28 rounded-xl" />
                <Bone className="h-9 w-28 rounded-xl" />
              </div>
            </section>

            {/* What happens next */}
            <section className={cn(CARD)}>
              <Bone className="mb-3 h-6 w-48" />
              <div className="flex flex-col gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Bone key={i} className="h-5 w-full max-w-xl" />
                ))}
              </div>
            </section>

            {/* Cancellation policy */}
            <section className={cn(CARD)}>
              <Bone className="mb-3 h-6 w-44" />
              <Bone className="h-5 w-full max-w-2xl" />
            </section>
          </div>
        </div>
      </div>
      <span className="sr-only">Loading booking confirmation...</span>
    </main>
  );
}
