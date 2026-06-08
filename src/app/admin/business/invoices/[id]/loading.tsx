// src/app/admin/business/invoices/[id]/loading.tsx
/**
 * @file loading.tsx
 * @description Loading skeleton for a single invoice: the actions bar plus the
 * invoice document card (wordmark + INVOICE block, parties, line items, totals)
 * in the same max-w-3xl column the page uses.
 */

import type React from "react";
import { cn } from "@/shared/lib/cn";
import { Bone } from "@/shared/components/Skeleton";
import { AdminSkeletonShell } from "@/features/admin/components/AdminSkeletonShell";

/**
 * Invoice detail loading skeleton.
 * @returns Skeleton element.
 */
export default function InvoiceDetailLoading(): React.ReactElement {
  return (
    <AdminSkeletonShell label="Loading invoice" contentClassName="mx-auto max-w-3xl px-6 py-8">
      {/* Actions bar */}
      <div className={cn("mb-6 flex flex-wrap items-center gap-2")}>
        <Bone className={cn("h-9 w-20 bg-slate-200")} />
        <div className={cn("ml-auto flex gap-2")}>
          <Bone className={cn("h-9 w-24 bg-slate-200")} />
          <Bone className={cn("h-9 w-24 bg-slate-200")} />
        </div>
      </div>

      {/* Invoice document */}
      <div className={cn("rounded-xl border border-slate-200 bg-white p-8 shadow-sm")}>
        {/* Header: wordmark + INVOICE block */}
        <div className={cn("mb-8 flex items-start justify-between gap-4")}>
          <Bone className={cn("h-20 w-48 bg-slate-200")} />
          <div className={cn("flex flex-col items-end gap-2")}>
            <Bone className={cn("h-7 w-32 bg-slate-200")} />
            <Bone className={cn("h-4 w-24 bg-slate-200 opacity-60")} />
            <Bone className={cn("h-3 w-16 bg-slate-200 opacity-60")} />
          </div>
        </div>

        {/* Parties + dates */}
        <div className={cn("mb-8 grid grid-cols-2 gap-4")}>
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className={cn("flex flex-col gap-2")}>
              <Bone className={cn("h-3 w-20 bg-slate-200 opacity-60")} />
              <Bone className={cn("h-4 w-36 bg-slate-200")} />
              <Bone className={cn("h-4 w-28 bg-slate-200")} />
            </div>
          ))}
        </div>

        {/* Line items */}
        <div className={cn("mb-6 flex flex-col gap-2")}>
          <Bone className={cn("h-8 w-full bg-slate-200")} />
          {Array.from({ length: 4 }).map((_, i) => (
            <Bone key={i} className={cn("h-6 w-full bg-slate-200 opacity-70")} />
          ))}
        </div>

        {/* Totals */}
        <div className={cn("ml-auto flex w-full max-w-xs flex-col gap-2")}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={cn("flex items-center justify-between gap-3")}>
              <Bone className={cn("h-4 w-20 bg-slate-200 opacity-60")} />
              <Bone className={cn("h-4 w-16 bg-slate-200")} />
            </div>
          ))}
          <div
            className={cn("flex items-center justify-between gap-3 border-t border-slate-100 pt-2")}
          >
            <Bone className={cn("h-5 w-16 bg-slate-200")} />
            <Bone className={cn("h-5 w-20 bg-slate-200")} />
          </div>
        </div>
      </div>
    </AdminSkeletonShell>
  );
}
