// src/features/admin/components/AdminListSkeleton.tsx
/**
 * @description Loading skeleton for the admin data-table views (Bookings,
 * Income, Expenses, Invoices, Contacts, Promos): heading + filter chips + the
 * card-on-mobile / table-on-desktop card list. Travel and Price-estimates have
 * their own skeletons - neither has a filter row.
 * The data-table route loading.tsx files re-export this as their default.
 * Renders content bones only - the (shell) layout supplies the sidebar +
 * padding, so no skeleton frame is needed here.
 */

import { Bone } from "@/shared/components/Skeleton";
import type React from "react";

/**
 * Admin list-view loading skeleton.
 * @returns Skeleton element.
 */
export function AdminListSkeleton(): React.ReactElement {
  return (
    <div role="status" aria-live="polite" aria-label="Loading">
      {/* Page heading. */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Bone className="mb-2 h-7 w-36 bg-slate-200" />
          <Bone className="h-3 w-48 bg-slate-200 opacity-60" />
        </div>
        <Bone className="h-9 w-28 bg-slate-200" />
      </div>

      {/* Filter chips / action bar. */}
      <div className="mb-4 flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Bone key={i} className="h-8 w-20 bg-slate-200" />
        ))}
      </div>

      {/* Card list. */}
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Bone className="mb-2 h-4 w-40 max-w-full bg-slate-200" />
                <Bone className="h-3 w-24 bg-slate-200 opacity-60" />
              </div>
              <Bone className="h-6 w-16 shrink-0 bg-slate-200" />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Bone className="h-3 w-20 bg-slate-200 opacity-60" />
              <Bone className="h-3 w-16 bg-slate-200 opacity-60" />
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only">Loading...</span>
    </div>
  );
}
