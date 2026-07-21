// src/app/admin/(shell)/schedule/loading.tsx
/**
 * @description Loading skeleton for the schedule: a day-agenda placeholder on
 * mobile and the week grid (toolbar + 7 day columns) from lg up, matching the
 * DayAgendaView / WeekView split.
 */

import { Bone } from "@/shared/components/Skeleton";
import type React from "react";

/**
 * Schedule page loading skeleton.
 * @returns Skeleton element.
 */
export default function ScheduleLoading(): React.ReactElement {
  return (
    <div role="status" aria-live="polite" aria-label="Loading schedule">
      {/* Page title. */}
      <Bone className="mb-6 h-8 w-40 bg-slate-200" />

      {/* Toolbar: prev/next + current range. */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <Bone className="h-9 w-40 bg-slate-200" />
        <div className="flex gap-2">
          <Bone className="h-9 w-9 bg-slate-200" />
          <Bone className="h-9 w-9 bg-slate-200" />
        </div>
      </div>

      {/* Mobile: day agenda. */}
      <div className="lg:hidden">
        <div className="mb-4 flex gap-2 overflow-x-auto">
          {Array.from({ length: 7 }).map((_, i) => (
            <Bone key={i} className="h-14 w-12 shrink-0 bg-slate-200" />
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Bone key={i} className="h-16 w-full bg-slate-200" />
          ))}
        </div>
      </div>

      {/* Desktop: week grid. */}
      <div className="hidden lg:block">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 grid grid-cols-7 gap-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <Bone key={i} className="h-6 w-full bg-slate-200" />
            ))}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 7 }).map((_, col) => (
              <div key={col} className="flex flex-col gap-2">
                {Array.from({ length: 5 }).map((_, row) => (
                  <Bone key={row} className="h-12 w-full bg-slate-200 opacity-70" />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
