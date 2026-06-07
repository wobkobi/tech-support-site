// src/app/admin/settings/loading.tsx
/**
 * @file loading.tsx
 * @description Loading skeleton for the settings panel: heading + intro, the
 * horizontal tab strip and a form card of labelled field rows with a save bar.
 */

import type React from "react";
import { cn } from "@/shared/lib/cn";
import { Bone } from "@/shared/components/Skeleton";
import { AdminSkeletonShell } from "@/features/admin/components/AdminSkeletonShell";

/**
 * Settings page loading skeleton.
 * @returns Skeleton element.
 */
export default function SettingsLoading(): React.ReactElement {
  return (
    <AdminSkeletonShell label="Loading settings page">
      <Bone className={cn("mb-1 h-8 w-36 bg-slate-200")} />
      <Bone className={cn("mb-6 h-4 w-full max-w-xl bg-slate-200 opacity-60")} />

      {/* Tab strip */}
      <div className={cn("mb-6 flex gap-1 overflow-x-auto border-b border-slate-200 pb-px")}>
        {Array.from({ length: 8 }).map((_, i) => (
          <Bone key={i} className={cn("h-9 w-24 shrink-0 bg-slate-200")} />
        ))}
      </div>

      {/* Form card with field rows */}
      <div className={cn("rounded-xl border border-slate-200 bg-white p-6 shadow-sm")}>
        <div className={cn("flex flex-col gap-6")}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={cn("flex flex-col gap-2")}>
              <Bone className={cn("h-4 w-40 bg-slate-200")} />
              <Bone className={cn("h-3 w-full max-w-lg bg-slate-200 opacity-60")} />
              <Bone className={cn("h-10 w-full max-w-xs bg-slate-200")} />
            </div>
          ))}
          <div className={cn("flex gap-3 border-t border-slate-100 pt-4")}>
            <Bone className={cn("h-10 w-28 bg-slate-200")} />
            <Bone className={cn("h-10 w-24 bg-slate-200")} />
          </div>
        </div>
      </div>
    </AdminSkeletonShell>
  );
}
