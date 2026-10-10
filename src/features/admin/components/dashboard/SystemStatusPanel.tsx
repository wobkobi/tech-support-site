// src/features/admin/components/dashboard/SystemStatusPanel.tsx
// Dashboard panel showing how fresh the sync sources are: calendar cache, latest invoice
// and unsynced contacts.

import { DashboardPanel } from "@/features/admin/components/dashboard/DashboardPanel";
import type { RecentInvoice } from "@/features/admin/lib/dashboard-data";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import type React from "react";

/** Calendar cache older than this reads as stale (amber). */
const CALENDAR_STALE_MS = 30 * 60 * 1000;

/**
 * System status panel. A never-refreshed calendar cache shows in red, one older than
 * {@link CALENDAR_STALE_MS} or any unsynced contacts in amber.
 * @param props - Component props.
 * @param props.calendarLastRefreshMs - Milliseconds since the last calendar refresh, or null.
 * @param props.latestInvoice - The newest invoice or quote, if any.
 * @param props.unsyncedCount - Contacts not yet synced to Google.
 * @returns The panel element.
 */
export function SystemStatusPanel({
  calendarLastRefreshMs,
  latestInvoice,
  unsyncedCount,
}: {
  calendarLastRefreshMs: number | null;
  latestInvoice: RecentInvoice | undefined;
  unsyncedCount: number;
}): React.ReactElement {
  return (
    <DashboardPanel
      title="System status"
      action={{ label: "Settings", href: "/admin/settings" }}
      empty=""
    >
      <ul className="divide-y divide-admin-border text-sm">
        <li className="flex items-center justify-between px-5 py-3">
          <span className="text-admin-text-secondary">Calendar cache</span>
          <span
            className={cn(
              "text-sm",
              calendarLastRefreshMs === null
                ? "font-medium text-coquelicot-700"
                : calendarLastRefreshMs > CALENDAR_STALE_MS
                  ? "text-amber-700"
                  : "text-admin-muted",
            )}
          >
            {calendarLastRefreshMs === null
              ? "never refreshed"
              : `refreshed ${Math.round(calendarLastRefreshMs / 60000)} min ago`}
          </span>
        </li>
        <li className="flex items-center justify-between px-5 py-3">
          <span className="text-admin-text-secondary">Latest invoice</span>
          <span className="text-sm text-admin-muted">
            {latestInvoice
              ? `${latestInvoice.number} (${formatDateShort(latestInvoice.createdAt.toISOString())})`
              : "none yet"}
          </span>
        </li>
        <li className="flex items-center justify-between px-5 py-3">
          <span className="text-admin-text-secondary">Unsynced contacts</span>
          <span
            className={cn("text-sm", unsyncedCount > 0 ? "text-amber-700" : "text-admin-muted")}
          >
            {unsyncedCount === 0 ? "all synced" : `${unsyncedCount} pending`}
          </span>
        </li>
      </ul>
    </DashboardPanel>
  );
}
