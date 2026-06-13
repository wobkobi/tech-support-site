// src/features/admin/components/AdminSkeletonShell.tsx
/**
 * @file AdminSkeletonShell.tsx
 * @description Shared loading-skeleton frame for /admin/* routes: the sidebar
 * placeholder plus the content padding that mirrors AdminPageLayout, so every
 * admin route-loading file only has to supply its own content bones.
 */

import { Bone } from "@/shared/components/Skeleton";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/** Props for AdminSkeletonShell. */
interface AdminSkeletonShellProps {
  /** Page-specific content bones rendered in the main column. */
  children: React.ReactNode;
  /** Mirror of AdminPageLayout's contentClassName when a page overrides padding/width. */
  contentClassName?: string;
  /** Accessible label for the loading region (e.g. "Loading settings page"). */
  label?: string;
}

/**
 * Admin loading frame: slate sidebar skeleton + padded content column. Padding
 * mirrors AdminPageLayout so the skeleton doesn't jump to the real layout on
 * hydration.
 * @param props - Component props.
 * @param props.children - Page-specific content bones.
 * @param props.contentClassName - Optional content padding/width override.
 * @param props.label - Optional accessible label.
 * @returns Admin skeleton frame element.
 */
export function AdminSkeletonShell({
  children,
  contentClassName,
  label = "Loading admin page",
}: AdminSkeletonShellProps): React.ReactElement {
  return (
    <div
      className={cn("flex min-h-screen overflow-x-clip")}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      {/* Sidebar skeleton (lg+ only; mobile uses a drawer). */}
      <aside
        className={cn("hidden h-screen w-56 shrink-0 flex-col bg-russian-violet px-3 py-4 lg:flex")}
        aria-hidden="true"
      >
        <div className={cn("border-b border-white/10 px-2 pb-4")}>
          <Bone className={cn("mb-1 h-3 w-12 bg-white/20")} />
          <Bone className={cn("h-4 w-28 bg-white/20")} />
        </div>
        <div className={cn("flex flex-col gap-1 pt-4")}>
          {Array.from({ length: 7 }).map((_, i) => (
            <Bone key={i} className={cn("h-9 w-full bg-white/10")} />
          ))}
        </div>
      </aside>

      {/* Content column. Padding mirrors AdminPageLayout's
          `px-4 pb-8 pt-16 sm:px-6 sm:pt-8 lg:pt-8`. */}
      <div className={cn("min-w-0 flex-1 bg-slate-50")}>
        <div className={cn(contentClassName ?? "px-4 pt-16 pb-8 sm:px-6 sm:pt-8 lg:pt-8")}>
          {children}
          <span className={cn("sr-only")}>{label}...</span>
        </div>
      </div>
    </div>
  );
}
