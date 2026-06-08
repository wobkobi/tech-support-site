// src/app/admin/contacts/conflicts/loading.tsx
/**
 * @file loading.tsx
 * @description Loading skeleton for the contact-conflicts page: heading + intro
 * and a list of conflict cards (field label + the two candidate values to pick
 * between).
 */

import { AdminSkeletonShell } from "@/features/admin/components/AdminSkeletonShell";
import { Bone } from "@/shared/components/Skeleton";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/**
 * Contact conflicts loading skeleton.
 * @returns Skeleton element.
 */
export default function ConflictsLoading(): React.ReactElement {
  return (
    <AdminSkeletonShell label="Loading contact conflicts">
      <Bone className={cn("mb-2 h-8 w-52 bg-slate-200")} />
      <Bone className={cn("mb-6 h-4 w-full max-w-2xl bg-slate-200 opacity-60")} />

      <div className={cn("flex flex-col gap-4")}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className={cn("rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}>
            <Bone className={cn("mb-4 h-4 w-32 bg-slate-200")} />
            <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2")}>
              {Array.from({ length: 2 }).map((_, j) => (
                <div key={j} className={cn("rounded-lg border border-slate-100 p-3")}>
                  <Bone className={cn("mb-2 h-3 w-20 bg-slate-200 opacity-60")} />
                  <Bone className={cn("h-5 w-full max-w-[12rem] bg-slate-200")} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </AdminSkeletonShell>
  );
}
