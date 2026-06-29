// src/app/admin/loading.tsx
/**
 * @description Loading skeleton for the /admin dashboard (this segment's index
 * page): today snapshot bar, quick-action row, stat-card grid and the 2x2
 * data-panel grid. Child routes define their own loading.tsx, so this covers
 * only the dashboard index.
 */

import { AdminSkeletonShell } from "@/features/admin/components/AdminSkeletonShell";
import { Bone } from "@/shared/components/Skeleton";
import type React from "react";

/**
 * Admin dashboard loading skeleton.
 * @returns Skeleton element.
 */
export default function AdminDashboardLoading(): React.ReactElement {
  return (
    <AdminSkeletonShell label="Loading dashboard">
      <Bone className="mb-6 h-8 w-40 bg-slate-200" />

      {/* Today snapshot bar */}
      <div className="mb-6 rounded-xl border border-russian-violet/20 bg-white px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Bone className="h-4 w-12 bg-slate-200" />
          <Bone className="h-4 w-28 bg-slate-200" />
          <Bone className="h-4 w-32 bg-slate-200" />
        </div>
      </div>

      {/* Quick actions row */}
      <div className="mb-6 flex flex-wrap gap-3">
        <Bone className="h-10 w-40 bg-slate-200" />
        <Bone className="h-10 w-40 bg-slate-200" />
      </div>

      {/* Stat cards */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
            <Bone className="mb-2 h-7 w-20 bg-slate-200" />
            <Bone className="h-3 w-24 bg-slate-200 opacity-60" />
          </div>
        ))}
      </div>

      {/* Data panels (2x2) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <Bone className="h-4 w-36 bg-slate-200" />
              <Bone className="h-3 w-16 bg-slate-200 opacity-60" />
            </div>
            <div className="divide-y divide-slate-100">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="flex items-start justify-between gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <Bone className="mb-1.5 h-4 w-32 max-w-full bg-slate-200" />
                    <Bone className="h-3 w-40 max-w-full bg-slate-200 opacity-60" />
                  </div>
                  <Bone className="h-3 w-16 shrink-0 bg-slate-200 opacity-60" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </AdminSkeletonShell>
  );
}
