// src/features/admin/components/dashboard/PendingReviewsPanel.tsx
// Dashboard panel listing the newest reviews waiting for approval.

import { DashboardPanel } from "@/features/admin/components/dashboard/DashboardPanel";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import type { PendingReviewRow } from "@/features/admin/lib/dashboard-data";
import { formatDateShort } from "@/shared/lib/date-format";
import Link from "next/link";
import type React from "react";

/**
 * Pending reviews panel: reviewer name, date and a two-line excerpt per review, each
 * linking to the reviews page. The badge shows the full pending count, not just the rows.
 * @param props - Component props.
 * @param props.pendingReviews - The newest pending reviews.
 * @param props.pendingCount - Total pending reviews, for the badge.
 * @returns The panel element.
 */
export function PendingReviewsPanel({
  pendingReviews,
  pendingCount,
}: {
  pendingReviews: PendingReviewRow[];
  pendingCount: number;
}): React.ReactElement {
  return (
    <DashboardPanel
      title="Pending reviews"
      badge={
        pendingReviews.length > 0 ? (
          <StatusPill tone="critical">{pendingCount}</StatusPill>
        ) : undefined
      }
      action={{ label: "Review all", href: "/admin/reviews" }}
      empty="No reviews pending approval."
    >
      {pendingReviews.length === 0 ? null : (
        <ul className="divide-y divide-admin-border">
          {pendingReviews.map((r) => {
            const name = r.isAnonymous
              ? "Anonymous"
              : [r.firstName, r.lastName].filter(Boolean).join(" ") || "Unknown";
            return (
              <li key={r.id}>
                <Link
                  href="/admin/reviews"
                  className="block px-5 py-3 transition-colors hover:bg-admin-bg"
                >
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-admin-text-secondary">{name}</p>
                    <p className="shrink-0 text-sm text-admin-faint">
                      {formatDateShort(r.createdAt.toISOString())}
                    </p>
                  </div>
                  <p className="line-clamp-2 text-sm text-admin-muted">{r.text}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardPanel>
  );
}
