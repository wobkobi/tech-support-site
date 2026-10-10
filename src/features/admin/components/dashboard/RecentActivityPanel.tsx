// src/features/admin/components/dashboard/RecentActivityPanel.tsx
// Dashboard panel for the unified activity timeline across bookings, reviews, contacts
// and invoices, each row linking to its record.

import { DashboardPanel } from "@/features/admin/components/dashboard/DashboardPanel";
import type { ActivityEvent } from "@/features/admin/lib/dashboard-data";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import Link from "next/link";
import type React from "react";

/**
 * Recent activity panel: a lettered kind chip (B, R, C, I), the event title and detail,
 * and its date per row, newest first.
 * @param props - Component props.
 * @param props.activity - Events already merged and sorted newest first.
 * @returns The panel element.
 */
export function RecentActivityPanel({
  activity,
}: {
  activity: ActivityEvent[];
}): React.ReactElement {
  return (
    <DashboardPanel title="Recent activity" empty="No activity yet.">
      {activity.length === 0 ? null : (
        <ul className="divide-y divide-admin-border">
          {activity.map((e, i) => (
            <li key={`${e.kind}:${i}:${e.timestamp.getTime()}`}>
              <Link
                href={e.href}
                className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-admin-bg"
              >
                <span
                  className={cn(
                    "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                    e.kind === "booking" && "bg-moonstone-400/15 text-moonstone-700",
                    e.kind === "review" && "bg-amber-500/15 text-amber-800",
                    e.kind === "contact" && "bg-admin-border text-admin-muted",
                    e.kind === "invoice" && "bg-russian-violet/15 text-russian-violet",
                  )}
                  aria-hidden="true"
                >
                  {e.kind === "booking"
                    ? "B"
                    : e.kind === "review"
                      ? "R"
                      : e.kind === "contact"
                        ? "C"
                        : "I"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium wrap-break-word text-admin-text">{e.title}</p>
                  <p className="truncate text-sm text-admin-faint">{e.detail}</p>
                </div>
                <p className="shrink-0 text-sm text-admin-faint">
                  {formatDateShort(e.timestamp.toISOString())}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DashboardPanel>
  );
}
