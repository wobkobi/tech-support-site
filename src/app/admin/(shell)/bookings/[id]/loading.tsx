// src/app/admin/(shell)/bookings/[id]/loading.tsx
/**
 * @description Booking detail loading skeleton - a two-column shell matching the
 * detail page so the list skeleton from the parent segment doesn't flash here.
 */
import type React from "react";

/**
 * Booking detail loading skeleton.
 * @returns The skeleton element.
 */
export default function BookingDetailLoading(): React.ReactElement {
  return (
    <div aria-hidden>
      <div className="mb-6 h-8 w-64 animate-pulse rounded bg-admin-surface" />
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6">
        <div className="space-y-4">
          <div className="h-64 animate-pulse rounded-xl border border-admin-border bg-admin-surface" />
          <div className="h-40 animate-pulse rounded-xl border border-admin-border bg-admin-surface" />
        </div>
        <div className="mt-4 space-y-4 lg:mt-0">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-xl border border-admin-border bg-admin-surface"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
