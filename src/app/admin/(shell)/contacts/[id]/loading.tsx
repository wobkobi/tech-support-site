// src/app/admin/(shell)/contacts/[id]/loading.tsx
/**
 * @description Loading skeleton for the customer-360 contact detail: header,
 * four stat cards, and the timeline + rail two-column, matching the real page.
 */

import { Bone } from "@/shared/components/Skeleton";
import type React from "react";

/**
 * Contact detail loading skeleton.
 * @returns Skeleton element.
 */
export default function ContactDetailLoading(): React.ReactElement {
  return (
    <div role="status" aria-live="polite" aria-label="Loading contact">
      {/* Header: breadcrumb + title + actions */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Bone className="h-7 w-48 bg-slate-200" />
        <div className="ml-auto flex gap-2">
          <Bone className="h-9 w-16 bg-slate-200" />
          <Bone className="h-9 w-28 bg-slate-200" />
          <Bone className="h-9 w-16 bg-slate-200" />
        </div>
      </div>

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Bone key={i} className="h-20 w-full bg-slate-200" />
        ))}
      </div>

      {/* Timeline + rail */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-6">
        <Bone className="h-80 w-full bg-slate-200" />
        <div className="mt-6 flex flex-col gap-4 lg:mt-0">
          <Bone className="h-48 w-full bg-slate-200" />
          <Bone className="h-28 w-full bg-slate-200" />
        </div>
      </div>
    </div>
  );
}
