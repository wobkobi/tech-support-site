// src/app/admin/business/calculator/loading.tsx
/**
 * @file loading.tsx
 * @description Loading skeleton for the job calculator: heading plus the
 * two-column layout - stacked input cards (time, tasks, parts, travel) on the
 * left and the totals / invoice-preview panel on the right.
 */

import type React from "react";
import { cn } from "@/shared/lib/cn";
import { Bone } from "@/shared/components/Skeleton";
import { AdminSkeletonShell } from "@/features/admin/components/AdminSkeletonShell";

/**
 * Calculator page loading skeleton.
 * @returns Skeleton element.
 */
export default function CalculatorLoading(): React.ReactElement {
  return (
    <AdminSkeletonShell label="Loading job calculator">
      <Bone className={cn("mb-6 h-8 w-44 bg-slate-200")} />

      <div className={cn("grid gap-6 lg:grid-cols-2")}>
        {/* Left: input cards */}
        <div className={cn("flex flex-col gap-4")}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className={cn("rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}
            >
              <Bone className={cn("mb-4 h-5 w-32 bg-slate-200")} />
              <div className={cn("flex flex-col gap-3")}>
                <Bone className={cn("h-10 w-full bg-slate-200")} />
                <div className={cn("flex gap-2")}>
                  <Bone className={cn("h-10 flex-1 bg-slate-200")} />
                  <Bone className={cn("h-10 flex-1 bg-slate-200")} />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Right: totals / preview panel */}
        <div className={cn("flex flex-col gap-4")}>
          <div className={cn("rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}>
            <Bone className={cn("mb-4 h-5 w-28 bg-slate-200")} />
            <div className={cn("flex flex-col gap-3")}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className={cn("flex items-center justify-between gap-3")}>
                  <Bone className={cn("h-4 w-28 bg-slate-200 opacity-60")} />
                  <Bone className={cn("h-4 w-16 bg-slate-200")} />
                </div>
              ))}
              <div
                className={cn(
                  "flex items-center justify-between gap-3 border-t border-slate-100 pt-3",
                )}
              >
                <Bone className={cn("h-5 w-20 bg-slate-200")} />
                <Bone className={cn("h-5 w-24 bg-slate-200")} />
              </div>
            </div>
          </div>
          <Bone className={cn("h-11 w-full bg-slate-200")} />
        </div>
      </div>
    </AdminSkeletonShell>
  );
}
