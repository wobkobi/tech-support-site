// src/app/admin/(shell)/business/quick/loading.tsx
// Loading skeleton for the quick price page: heading, the input card and the total card.

import { Bone } from "@/shared/components/Skeleton";
import type React from "react";

/**
 * Quick price loading skeleton.
 * @returns Skeleton element.
 */
export default function QuickPriceLoading(): React.ReactElement {
  return (
    <div role="status" aria-live="polite" aria-label="Loading quick price">
      <Bone className="mb-6 h-8 w-36 bg-slate-200" />
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <Bone className="h-10 w-full bg-slate-200" />
          <div className="grid grid-cols-2 gap-3">
            <Bone className="h-10 bg-slate-200" />
            <Bone className="h-10 bg-slate-200" />
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <Bone className="h-4 w-24 bg-slate-200 opacity-60" />
          <Bone className="mt-2 h-12 w-40 bg-slate-200" />
          <div className="mt-4 flex flex-col gap-2">
            <Bone className="h-5 w-full bg-slate-200 opacity-60" />
            <Bone className="h-5 w-full bg-slate-200 opacity-60" />
          </div>
        </div>
      </div>
    </div>
  );
}
