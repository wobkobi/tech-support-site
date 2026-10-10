// src/features/admin/components/dashboard/DashboardAlerts.tsx
// Warning notices under the dashboard KPIs for overdue invoices and held bookings; renders
// nothing when neither needs action.

import { Notice } from "@/shared/components/Notice";
import Link from "next/link";
import type React from "react";

/** Link style for the line inside an alert notice. */
const ALERT_LINK_CLS = "font-bold text-russian-violet underline-offset-2 hover:underline";

/**
 * Dashboard alerts: one notice per condition that needs action, each linking to the list
 * filtered to what it counts. White fill (onGrey) because the admin page sits on seasalt.
 * @param props - Component props.
 * @param props.overdueCount - Sent invoices past their due date.
 * @param props.heldCount - Bookings on hold waiting for a decision.
 * @returns The notices grid, or null when there is nothing to flag.
 */
export function DashboardAlerts({
  overdueCount,
  heldCount,
}: {
  overdueCount: number;
  heldCount: number;
}): React.ReactElement | null {
  if (overdueCount === 0 && heldCount === 0) return null;
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-2">
      {overdueCount > 0 && (
        <Notice tone="warn" onGrey>
          <Link href="/admin/business/invoices?status=overdue" className={ALERT_LINK_CLS}>
            <span className="font-semibold">{overdueCount}</span> overdue invoice
            {overdueCount === 1 ? "" : "s"}
          </Link>
        </Notice>
      )}
      {heldCount > 0 && (
        <Notice tone="warn" onGrey>
          <Link href="/admin/bookings?status=held" className={ALERT_LINK_CLS}>
            <span className="font-semibold">{heldCount}</span> held booking
            {heldCount === 1 ? "" : "s"} to action
          </Link>
        </Notice>
      )}
    </div>
  );
}
