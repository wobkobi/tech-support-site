// src/app/admin/loading.tsx
import type React from "react";
import { cn } from "@/shared/lib/cn";

/**
 * Animated skeleton bone used to fill skeleton placeholder areas.
 * @param root0 - Component props.
 * @param root0.className - Additional CSS classes for sizing/positioning.
 * @returns Skeleton bone element.
 */
function Bone({ className }: { className?: string }): React.ReactElement {
  return <div className={cn("animate-pulse rounded-lg bg-slate-200", className)} />;
}

/**
 * Admin dashboard loading skeleton shown via React Suspense while DB queries run.
 * @returns Loading skeleton element.
 */
export default function AdminLoading(): React.ReactElement {
  return (
    <div className={cn("flex min-h-screen")}>
      {/* Sidebar skeleton */}
      <aside className={cn("bg-russian-violet fixed inset-y-0 left-0 z-10 flex w-56 flex-col")}>
        <div className={cn("border-b border-white/10 px-5 py-5")}>
          <Bone className={cn("mb-1 h-3 w-12 bg-white/20")} />
          <Bone className={cn("h-4 w-28 bg-white/20")} />
        </div>
        <div className={cn("flex flex-col gap-1 px-3 py-4")}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Bone key={i} className={cn("h-9 w-full bg-white/10")} />
          ))}
        </div>
      </aside>

      {/* Content skeleton */}
      <div className={cn("ml-56 flex-1 bg-slate-50")}>
        <div className={cn("mx-auto max-w-7xl px-6 py-8")}>
          <Bone className={cn("mb-6 h-8 w-36")} />

          {/* Stat cards */}
          <div className={cn("mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3")}>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className={cn("rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}
              >
                <Bone className={cn("mb-2 h-8 w-10")} />
                <Bone className={cn("h-3 w-28 opacity-60")} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
