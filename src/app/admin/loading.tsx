// src/app/admin/loading.tsx
import type React from "react";
import { cn } from "@/shared/lib/cn";

/**
 * Skeleton placeholder div.
 * @param root0 - Props.
 * @param root0.className - Sizing/positioning classes.
 * @returns Bone element.
 */
function Bone({ className }: { className?: string }): React.ReactElement {
  return <div className={cn("animate-pulse rounded-lg bg-slate-200", className)} />;
}

/**
 * Loading UI for every /admin/* route.
 * @returns Skeleton element.
 */
export default function AdminLoading(): React.ReactElement {
  return (
    <div
      className={cn("flex min-h-screen")}
      role="status"
      aria-live="polite"
      aria-label="Loading admin page"
    >
      {/* Sidebar skeleton (lg+ only; mobile uses a drawer). */}
      <aside
        className={cn("bg-russian-violet hidden h-screen w-56 shrink-0 flex-col px-3 py-4 lg:flex")}
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

      {/* Content skeleton. */}
      <div className={cn("flex-1 bg-slate-50 lg:ml-0")}>
        <div className={cn("px-4 pb-8 pt-16 sm:px-6 sm:pt-8 lg:pt-8")}>
          <Bone className={cn("mb-6 h-8 w-36")} />

          {/* Stat cards. */}
          <div className={cn("mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4")}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className={cn("rounded-xl border border-slate-200 bg-white p-4 shadow-sm")}
              >
                <Bone className={cn("mb-2 h-7 w-12")} />
                <Bone className={cn("h-3 w-20 opacity-60")} />
              </div>
            ))}
          </div>

          {/* Generic panel placeholder. */}
          <div className={cn("rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}>
            <Bone className={cn("mb-4 h-5 w-32")} />
            <div className={cn("space-y-3")}>
              {Array.from({ length: 5 }).map((_, i) => (
                <Bone key={i} className={cn("h-12")} />
              ))}
            </div>
          </div>

          <span className={cn("sr-only")}>Loading admin page...</span>
        </div>
      </div>
    </div>
  );
}
