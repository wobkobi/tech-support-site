// src/app/admin/business/loading.tsx
/**
 * @file loading.tsx
 * @description Loading skeleton for the business dashboard: FY scope tabs, the
 * overview stat cards, the tax-planner panel and the action-link row.
 */

import { AdminSkeletonShell } from "@/features/admin/components/AdminSkeletonShell";
import { Bone } from "@/shared/components/Skeleton";
import type React from "react";

/**
 * Business dashboard loading skeleton.
 * @returns Skeleton element.
 */
export default function BusinessLoading(): React.ReactElement {
  return (
    <AdminSkeletonShell label="Loading business page">
      <Bone className="mb-6 h-8 w-36 bg-slate-200" />

      {/* FY scope tabs */}
      <div className="mb-6 flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Bone key={i} className="h-9 w-24 bg-slate-200" />
        ))}
      </div>

      {/* Overview stat cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <Bone className="mb-3 h-4 w-28 bg-slate-200 opacity-60" />
            <Bone className="h-8 w-32 bg-slate-200" />
          </div>
        ))}
      </div>

      {/* Tax planner panel */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <Bone className="mb-4 h-6 w-40 bg-slate-200" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <Bone className="h-4 w-32 bg-slate-200 opacity-60" />
              <Bone className="h-4 w-20 bg-slate-200" />
            </div>
          ))}
        </div>
      </div>

      {/* Action links */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {Array.from({ length: 4 }).map((_, i) => (
          <Bone key={i} className="h-10 w-full bg-slate-200 sm:w-28" />
        ))}
      </div>
    </AdminSkeletonShell>
  );
}
