// src/app/booking/cancel/loading.tsx
/**
 * @description Streaming skeleton for the booking cancel page. Matches the
 * page's own frosted container (not PageShell) so it doesn't inherit the
 * booking-form skeleton: a single card with the heading, detail lines, a fee
 * banner placeholder and the action buttons.
 */

import { Bone } from "@/shared/components/Skeleton";
import { cn } from "@/shared/lib/cn";
import type React from "react";

const CARD = "border-seasalt-200/60 bg-white rounded-xl border p-5 shadow-sm sm:p-6";

/**
 * Booking cancel route-loading skeleton.
 * @returns Skeleton element.
 */
export default function BookingCancelLoading(): React.ReactElement {
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
          <section
            className={cn(CARD)}
            role="status"
            aria-live="polite"
            aria-label="Loading booking cancellation"
          >
            <Bone className="mb-4 h-9 w-56 sm:h-10" />
            <Bone className="mb-4 h-5 w-full max-w-md" />
            {/* Fee banner */}
            <Bone className="mb-4 h-16 w-full rounded-lg" />
            <div className="flex flex-wrap gap-3">
              <Bone className="h-11 w-48 rounded-xl" />
              <Bone className="h-9 w-36 rounded-xl" />
            </div>
          </section>
        </div>
      </div>
      <span className="sr-only">Loading booking cancellation...</span>
    </main>
  );
}
