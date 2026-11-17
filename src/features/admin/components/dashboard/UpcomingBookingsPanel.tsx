// src/features/admin/components/dashboard/UpcomingBookingsPanel.tsx
// Dashboard panel for the jobs after the next one (NextJobPanel shows that one): bookings link
// to their record, calendar-only jobs to their day on the schedule.

import { DashboardPanel } from "@/features/admin/components/dashboard/DashboardPanel";
import type { DashboardJob } from "@/features/admin/lib/dashboard-jobs";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import Link from "next/link";
import type React from "react";

/**
 * Second line of a row: a booking's contact details, or a calendar-only job's location.
 * @param job - The job.
 * @returns The line's text.
 */
function detailLine(job: DashboardJob): string {
  if (job.source === "calendar") return job.address ?? "Added in Google Calendar";
  return [job.email, job.phone].filter(Boolean).join(" · ");
}

/**
 * Upcoming jobs panel: the jobs after the next one, each a link.
 * @param props - Component props.
 * @param props.laterJobs - The jobs after the next job.
 * @returns The panel element.
 */
export function UpcomingBookingsPanel({
  laterJobs,
}: {
  laterJobs: DashboardJob[];
}): React.ReactElement {
  return (
    <DashboardPanel
      title="Upcoming jobs"
      action={{ label: "View schedule", href: "/admin/schedule" }}
      empty="Nothing else booked yet."
    >
      {laterJobs.length === 0 ? null : (
        <ul className="divide-y divide-admin-border">
          {laterJobs.map((job) => (
            <li key={`${job.source}:${job.key}`}>
              <Link
                href={job.href}
                className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-admin-bg sm:px-5"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-admin-text">{job.name}</p>
                  <p className="truncate text-sm text-admin-muted">{detailLine(job)}</p>
                </div>
                <p className="shrink-0 text-right text-sm font-medium text-admin-text-secondary">
                  {formatDateTimeShort(job.startAt.toISOString())}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DashboardPanel>
  );
}
