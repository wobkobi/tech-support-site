// src/features/admin/components/dashboard/UpcomingBookingsPanel.tsx
// Dashboard panel for the confirmed bookings after the next job (NextJobPanel shows that
// one), each a link to its record.

import { DashboardPanel } from "@/features/admin/components/dashboard/DashboardPanel";
import type { UpcomingBooking } from "@/features/admin/lib/dashboard-data";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import Link from "next/link";
import type React from "react";

/**
 * Upcoming bookings panel: the bookings after the next job as links to their records.
 * @param props - Component props.
 * @param props.laterBookings - The confirmed bookings after the next job.
 * @returns The panel element.
 */
export function UpcomingBookingsPanel({
  laterBookings,
}: {
  laterBookings: UpcomingBooking[];
}): React.ReactElement {
  return (
    <DashboardPanel
      title="Upcoming bookings"
      action={{ label: "View all", href: "/admin/bookings" }}
      empty="Nothing else booked yet."
    >
      {laterBookings.length === 0 ? null : (
        <ul className="divide-y divide-admin-border">
          {laterBookings.map((b) => (
            <li key={b.id}>
              <Link
                href={`/admin/bookings/${b.id}`}
                className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-admin-bg sm:px-5"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-admin-text">{b.name}</p>
                  <p className="truncate text-sm text-admin-muted">
                    {b.email}
                    {b.phone ? ` · ${b.phone}` : ""}
                  </p>
                </div>
                <p className="shrink-0 text-right text-sm font-medium text-admin-text-secondary">
                  {formatDateTimeShort(b.startAt.toISOString())}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DashboardPanel>
  );
}
