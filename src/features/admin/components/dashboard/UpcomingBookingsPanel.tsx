// src/features/admin/components/dashboard/UpcomingBookingsPanel.tsx
// Dashboard panel for the next confirmed job (with Call, Maps and Open buttons) and the
// confirmed bookings after it.

import { DashboardPanel } from "@/features/admin/components/dashboard/DashboardPanel";
import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { ADMIN_EYEBROW_CLS } from "@/features/admin/components/ui/field-classes";
import type { UpcomingBooking } from "@/features/admin/lib/dashboard-data";
import { mapsSearchUrl } from "@/features/booking/lib/booking";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import Link from "next/link";
import type React from "react";

/**
 * Upcoming bookings panel: the next job's details and one-tap actions, then the later
 * bookings as links to their records. Shows the empty state when there is no next job.
 * @param props - Component props.
 * @param props.nextJob - The soonest confirmed booking, if any.
 * @param props.nextJobAddress - Address for the Maps button; null for remote jobs.
 * @param props.laterBookings - The confirmed bookings after the next job.
 * @returns The panel element.
 */
export function UpcomingBookingsPanel({
  nextJob,
  nextJobAddress,
  laterBookings,
}: {
  nextJob: UpcomingBooking | undefined;
  nextJobAddress: string | null;
  laterBookings: UpcomingBooking[];
}): React.ReactElement {
  return (
    <DashboardPanel
      title="Upcoming bookings"
      action={{ label: "View all", href: "/admin/bookings" }}
      empty="No upcoming confirmed bookings."
    >
      {!nextJob ? null : (
        <>
          {/* Next job: the calls a morning needs, one tap each. */}
          <div className="border-b border-admin-border bg-russian-violet/5 px-5 py-4">
            <p className={ADMIN_EYEBROW_CLS}>Next job</p>
            <p className="mt-1 font-semibold wrap-break-word text-admin-text">{nextJob.name}</p>
            <p className="text-sm text-admin-text-secondary">
              {formatDateTimeShort(nextJob.startAt.toISOString())}
            </p>
            <p className="text-sm wrap-break-word text-admin-muted">{nextJobAddress ?? "Remote"}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {nextJob.phone && (
                <AdminButton variant="secondary" href={`tel:${nextJob.phone}`}>
                  Call
                </AdminButton>
              )}
              {nextJobAddress && (
                <AdminButton variant="secondary" href={mapsSearchUrl(nextJobAddress)}>
                  Maps ↗
                </AdminButton>
              )}
              <AdminButton variant="secondary" href={`/admin/bookings/${nextJob.id}`}>
                Open
              </AdminButton>
            </div>
          </div>
          {laterBookings.length > 0 && (
            <ul className="divide-y divide-admin-border">
              {laterBookings.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/admin/bookings/${b.id}`}
                    className="flex items-start justify-between gap-3 px-5 py-3 transition-colors hover:bg-admin-bg"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-admin-text">{b.name}</p>
                      <p className="truncate text-sm text-admin-faint">
                        {b.email}
                        {b.phone ? ` · ${b.phone}` : ""}
                      </p>
                    </div>
                    <p className="shrink-0 text-right text-sm text-admin-muted">
                      {formatDateTimeShort(b.startAt.toISOString())}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </DashboardPanel>
  );
}
