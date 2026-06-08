// src/app/admin/reviews/loading.tsx
/**
 * @file loading.tsx
 * @description Loading skeleton for the reviews moderation page: heading with
 * count chips and the 3-column layout - the approval list (2 cols) beside the
 * send-link and link-history cards.
 */

import { AdminSkeletonShell } from "@/features/admin/components/AdminSkeletonShell";
import { Bone } from "@/shared/components/Skeleton";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/**
 * Reviews page loading skeleton.
 * @returns Skeleton element.
 */
export default function ReviewsLoading(): React.ReactElement {
  return (
    <AdminSkeletonShell label="Loading reviews page">
      {/* Heading + count chips */}
      <div className={cn("mb-6 flex items-center gap-3")}>
        <Bone className={cn("h-8 w-32 bg-slate-200")} />
        <Bone className={cn("h-6 w-24 bg-slate-200 opacity-60")} />
      </div>

      <div className={cn("grid grid-cols-1 gap-6 lg:grid-cols-3")}>
        {/* Approval list */}
        <div className={cn("lg:col-span-2")}>
          <div className={cn("rounded-xl border border-slate-200 bg-white p-6 shadow-sm")}>
            <div className={cn("flex flex-col gap-4")}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className={cn("rounded-lg border border-slate-100 p-4")}>
                  <div className={cn("mb-2 flex items-center justify-between gap-3")}>
                    <Bone className={cn("h-4 w-32 bg-slate-200")} />
                    <Bone className={cn("h-3 w-20 bg-slate-200 opacity-60")} />
                  </div>
                  <Bone className={cn("mb-1.5 h-4 w-full bg-slate-200 opacity-70")} />
                  <Bone className={cn("mb-3 h-4 w-2/3 bg-slate-200 opacity-70")} />
                  <div className={cn("flex gap-2")}>
                    <Bone className={cn("h-8 w-20 bg-slate-200")} />
                    <Bone className={cn("h-8 w-20 bg-slate-200")} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Send link + link history */}
        <div className={cn("flex flex-col gap-6")}>
          <div className={cn("rounded-xl border border-slate-200 bg-white p-6 shadow-sm")}>
            <Bone className={cn("mb-4 h-4 w-32 bg-slate-200")} />
            <Bone className={cn("mb-3 h-10 w-full bg-slate-200")} />
            <Bone className={cn("h-10 w-28 bg-slate-200")} />
          </div>
          <div className={cn("rounded-xl border border-slate-200 bg-white p-6 shadow-sm")}>
            <Bone className={cn("mb-4 h-4 w-28 bg-slate-200")} />
            <div className={cn("flex flex-col gap-2")}>
              {Array.from({ length: 4 }).map((_, i) => (
                <Bone key={i} className={cn("h-6 w-full bg-slate-200 opacity-70")} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </AdminSkeletonShell>
  );
}
