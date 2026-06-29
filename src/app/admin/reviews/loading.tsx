// src/app/admin/reviews/loading.tsx
/**
 * @description Loading skeleton for the reviews moderation page: heading with
 * count chips and the 3-column layout - the approval list (2 cols) beside the
 * send-link and link-history cards.
 */

import { AdminSkeletonShell } from "@/features/admin/components/AdminSkeletonShell";
import { Bone } from "@/shared/components/Skeleton";
import type React from "react";

/**
 * Reviews page loading skeleton.
 * @returns Skeleton element.
 */
export default function ReviewsLoading(): React.ReactElement {
  return (
    <AdminSkeletonShell label="Loading reviews page">
      {/* Heading + count chips */}
      <div className="mb-6 flex items-center gap-3">
        <Bone className="h-8 w-32 bg-slate-200" />
        <Bone className="h-6 w-24 bg-slate-200 opacity-60" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Approval list */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-lg border border-slate-100 p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <Bone className="h-4 w-32 bg-slate-200" />
                    <Bone className="h-3 w-20 bg-slate-200 opacity-60" />
                  </div>
                  <Bone className="mb-1.5 h-4 w-full bg-slate-200 opacity-70" />
                  <Bone className="mb-3 h-4 w-2/3 bg-slate-200 opacity-70" />
                  <div className="flex gap-2">
                    <Bone className="h-8 w-20 bg-slate-200" />
                    <Bone className="h-8 w-20 bg-slate-200" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Send link + link history */}
        <div className="flex flex-col gap-6">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <Bone className="mb-4 h-4 w-32 bg-slate-200" />
            <Bone className="mb-3 h-10 w-full bg-slate-200" />
            <Bone className="h-10 w-28 bg-slate-200" />
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <Bone className="mb-4 h-4 w-28 bg-slate-200" />
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Bone key={i} className="h-6 w-full bg-slate-200 opacity-70" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </AdminSkeletonShell>
  );
}
