// src/app/admin/contacts/conflicts/loading.tsx
/**
 * @file loading.tsx
 * @description Loading skeleton for the contact-conflicts page: heading + intro
 * and a list of conflict cards (field label + the two candidate values to pick
 * between).
 */

import { AdminSkeletonShell } from "@/features/admin/components/AdminSkeletonShell";
import { Bone } from "@/shared/components/Skeleton";
import type React from "react";

/**
 * Contact conflicts loading skeleton.
 * @returns Skeleton element.
 */
export default function ConflictsLoading(): React.ReactElement {
  return (
    <AdminSkeletonShell label="Loading contact conflicts">
      <Bone className="mb-2 h-8 w-52 bg-slate-200" />
      <Bone className="mb-6 h-4 w-full max-w-2xl bg-slate-200 opacity-60" />

      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <Bone className="mb-4 h-4 w-32 bg-slate-200" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {Array.from({ length: 2 }).map((_, j) => (
                <div key={j} className="rounded-lg border border-slate-100 p-3">
                  <Bone className="mb-2 h-3 w-20 bg-slate-200 opacity-60" />
                  <Bone className="h-5 w-full max-w-48 bg-slate-200" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </AdminSkeletonShell>
  );
}
