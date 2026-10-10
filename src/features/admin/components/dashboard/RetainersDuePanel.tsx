// src/features/admin/components/dashboard/RetainersDuePanel.tsx
// Dashboard panel for retainer clients with no "retainer" invoice issued this month.

import { DashboardPanel } from "@/features/admin/components/dashboard/DashboardPanel";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import type { RetainerContact } from "@/features/admin/lib/dashboard-data";
import { formatNZD } from "@/features/business/lib/business";
import Link from "next/link";
import type React from "react";

/**
 * Retainers due panel: each uninvoiced retainer client links to their contact record,
 * with their tier and monthly price. The page only renders it once a retainer client exists.
 * @param props - Component props.
 * @param props.retainersDue - Retainer clients not yet invoiced this month.
 * @returns The panel element.
 */
export function RetainersDuePanel({
  retainersDue,
}: {
  retainersDue: RetainerContact[];
}): React.ReactElement {
  return (
    <DashboardPanel
      title="Retainers due"
      badge={
        retainersDue.length > 0 ? (
          <StatusPill tone="warning">{retainersDue.length}</StatusPill>
        ) : undefined
      }
      action={{ label: "New invoice", href: "/admin/business/calculator" }}
      empty="All retainers invoiced this month."
    >
      {retainersDue.length === 0 ? null : (
        <ul className="divide-y divide-admin-border">
          {retainersDue.map((r) => (
            <li key={r.id}>
              <Link
                href={`/admin/contacts/${r.id}`}
                className="flex items-start justify-between gap-3 px-5 py-3 transition-colors hover:bg-admin-bg"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-admin-text">{r.name}</p>
                  <p className="truncate text-sm text-admin-faint">{r.retainerTier}</p>
                </div>
                <p className="shrink-0 text-right text-sm text-admin-muted">
                  {r.retainerPrice !== null ? formatNZD(r.retainerPrice) : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DashboardPanel>
  );
}
