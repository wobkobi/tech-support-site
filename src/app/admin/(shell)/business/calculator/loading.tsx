// src/app/admin/(shell)/business/calculator/loading.tsx
/**
 * @description Loading skeleton for the job calculator: heading plus the
 * two-column layout - stacked input cards (time, tasks, parts, travel) on the
 * left and the totals / invoice-preview panel on the right.
 */

import { Bone } from "@/shared/components/Skeleton";
import type React from "react";

/**
 * Calculator page loading skeleton.
 * @returns Skeleton element.
 */
export default function CalculatorLoading(): React.ReactElement {
  return (
    <div role="status" aria-live="polite" aria-label="Loading job calculator">
      <Bone className="mb-6 h-8 w-44 bg-slate-200" />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: input cards */}
        <div className="flex flex-col gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <Bone className="mb-4 h-5 w-32 bg-slate-200" />
              <div className="flex flex-col gap-3">
                <Bone className="h-10 w-full bg-slate-200" />
                <div className="flex gap-2">
                  <Bone className="h-10 flex-1 bg-slate-200" />
                  <Bone className="h-10 flex-1 bg-slate-200" />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Right: totals / preview panel */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <Bone className="mb-4 h-5 w-28 bg-slate-200" />
            <div className="flex flex-col gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <Bone className="h-4 w-28 bg-slate-200 opacity-60" />
                  <Bone className="h-4 w-16 bg-slate-200" />
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                <Bone className="h-5 w-20 bg-slate-200" />
                <Bone className="h-5 w-24 bg-slate-200" />
              </div>
            </div>
          </div>
          <Bone className="h-11 w-full bg-slate-200" />
        </div>
      </div>
    </div>
  );
}
