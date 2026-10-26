// src/features/admin/components/dashboard/DashboardAlerts.tsx
// Warning notice under the dashboard KPIs for overdue invoices; renders nothing when
// none need action.

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
 * @returns The notices grid, or null when there is nothing to flag.
 */
export function DashboardAlerts({
  overdueCount,
}: {
  overdueCount: number;
}): React.ReactElement | null {
  if (overdueCount === 0) return null;
  return (
    <div className="mb-6 grid grid-cols-[repeat(auto-fit,minmax(min(18rem,100%),1fr))] gap-3">
      <Notice tone="warn" onGrey>
        <Link href="/admin/business/invoices?status=overdue" className={ALERT_LINK_CLS}>
          <span className="font-semibold">{overdueCount}</span> overdue invoice
          {overdueCount === 1 ? "" : "s"}
        </Link>
      </Notice>
    </div>
  );
}
