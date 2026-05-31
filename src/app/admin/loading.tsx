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
 * Loading UI for every /admin/* route. Heading + action bar + a card list
 * (the card-on-mobile, table-on-desktop pattern the data views use).
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

      {/* Content skeleton. Padding mirrors AdminPageLayout's
          `px-4 pb-8 pt-16 sm:px-6 sm:pt-8 lg:pt-8` so the mobile hamburger
          is cleared and the skeleton doesn't jump on hydration. */}
      <div className={cn("flex-1 bg-slate-50")}>
        <div className={cn("px-4 pb-8 pt-16 sm:px-6 sm:pt-8 lg:pt-8")}>
          {/* Page heading. */}
          <div className={cn("mb-6 flex flex-wrap items-center justify-between gap-3")}>
            <div>
              <Bone className={cn("mb-2 h-7 w-36")} />
              <Bone className={cn("h-3 w-48 opacity-60")} />
            </div>
            <Bone className={cn("h-9 w-28")} />
          </div>

          {/* Filter chips / action bar. */}
          <div className={cn("mb-4 flex flex-wrap gap-2")}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Bone key={i} className={cn("h-8 w-20")} />
            ))}
          </div>

          {/* Card list - mirrors the responsive card pattern every admin
              data view uses below lg (Bookings, Income, Expenses, Invoices,
              Subscriptions, Travel, etc). */}
          <div className={cn("space-y-2")}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className={cn("rounded-xl border border-slate-200 bg-white p-3 shadow-sm")}
              >
                <div className={cn("flex items-start justify-between gap-3")}>
                  <div className={cn("min-w-0 flex-1")}>
                    <Bone className={cn("mb-2 h-4 w-40 max-w-full")} />
                    <Bone className={cn("h-3 w-24 opacity-60")} />
                  </div>
                  <Bone className={cn("h-6 w-16 shrink-0")} />
                </div>
                <div className={cn("mt-3 flex flex-wrap items-center gap-3")}>
                  <Bone className={cn("h-3 w-20 opacity-60")} />
                  <Bone className={cn("h-3 w-16 opacity-60")} />
                </div>
              </div>
            ))}
          </div>

          <span className={cn("sr-only")}>Loading admin page...</span>
        </div>
      </div>
    </div>
  );
}
