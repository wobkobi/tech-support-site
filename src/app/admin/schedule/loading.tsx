// src/app/admin/schedule/loading.tsx
/**
 * @file loading.tsx
 * @description Loading skeleton for the schedule: a day-agenda placeholder on
 * mobile and the week grid (toolbar + 7 day columns) from lg up, matching the
 * DayAgendaView / WeekView split.
 */

import { AdminSkeletonShell } from "@/features/admin/components/AdminSkeletonShell";
import { Bone } from "@/shared/components/Skeleton";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/**
 * Schedule page loading skeleton.
 * @returns Skeleton element.
 */
export default function ScheduleLoading(): React.ReactElement {
  return (
    <AdminSkeletonShell label="Loading schedule">
      {/* Toolbar: prev/next + current range. */}
      <div className={cn("mb-4 flex items-center justify-between gap-3")}>
        <Bone className={cn("h-9 w-40 bg-slate-200")} />
        <div className={cn("flex gap-2")}>
          <Bone className={cn("h-9 w-9 bg-slate-200")} />
          <Bone className={cn("h-9 w-9 bg-slate-200")} />
        </div>
      </div>

      {/* Mobile: day agenda. */}
      <div className={cn("lg:hidden")}>
        <div className={cn("mb-4 flex gap-2 overflow-x-auto")}>
          {Array.from({ length: 7 }).map((_, i) => (
            <Bone key={i} className={cn("h-14 w-12 shrink-0 bg-slate-200")} />
          ))}
        </div>
        <div className={cn("flex flex-col gap-2")}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Bone key={i} className={cn("h-16 w-full bg-slate-200")} />
          ))}
        </div>
      </div>

      {/* Desktop: week grid. */}
      <div className={cn("hidden lg:block")}>
        <div className={cn("rounded-xl border border-slate-200 bg-white p-4 shadow-sm")}>
          <div className={cn("mb-3 grid grid-cols-7 gap-2")}>
            {Array.from({ length: 7 }).map((_, i) => (
              <Bone key={i} className={cn("h-6 w-full bg-slate-200")} />
            ))}
          </div>
          <div className={cn("grid grid-cols-7 gap-2")}>
            {Array.from({ length: 7 }).map((_, col) => (
              <div key={col} className={cn("flex flex-col gap-2")}>
                {Array.from({ length: 5 }).map((_, row) => (
                  <Bone key={row} className={cn("h-12 w-full bg-slate-200 opacity-70")} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </AdminSkeletonShell>
  );
}
