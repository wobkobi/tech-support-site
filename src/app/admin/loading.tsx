// src/app/admin/loading.tsx
/**
 * @file loading.tsx
 * @description Streaming skeleton for the admin page.
 * Shown immediately while the server fetches data (reviews, bookings, contacts, travel blocks).
 * This Suspense boundary lets the shell render in <100ms even though DB queries take ~3s.
 */

import { PageShell, FrostedSection, CARD } from "@/shared/components/PageLayout";
import { cn } from "@/shared/lib/cn";

/**
 * Animated skeleton bone used to fill skeleton placeholder areas.
 * @param props - Component props.
 * @param props.className - Additional CSS classes for sizing/positioning.
 * @returns Skeleton bone element.
 */
function Bone({ className }: { className?: string }): React.ReactElement {
  return <div className={cn("bg-seasalt-400/50 animate-pulse rounded-lg", className)} />;
}

/**
 * Admin page loading skeleton shown via React Suspense while DB queries run.
 * @returns Loading skeleton element.
 */
export default function AdminLoading(): React.ReactElement {
  return (
    <PageShell>
      <FrostedSection>
        <div className="flex flex-col gap-6 sm:gap-8">
          {/* Header card skeleton */}
          <section className={cn(CARD)}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Bone className="h-8 w-24" />
              <div className="flex gap-2">
                <Bone className="h-5 w-20 rounded-full" />
                <Bone className="h-5 w-24 rounded-full" />
              </div>
            </div>
          </section>

          {/* Tabs + content skeleton */}
          <section className={cn(CARD)}>
            {/* Tab bar */}
            <div className="border-seasalt-400/40 mb-6 flex gap-3 border-b pb-3">
              <Bone className="h-8 w-16 rounded-lg" />
              <Bone className="h-8 w-20 rounded-lg" />
              <Bone className="h-8 w-24 rounded-lg" />
              <Bone className="h-8 w-14 rounded-lg" />
            </div>

            {/* Row skeletons */}
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className={cn("border-seasalt-400/40 rounded-xl border p-4")}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-2">
                      <Bone className="h-4 w-40" />
                      <Bone className="h-3 w-56 opacity-60" />
                    </div>
                    <Bone className="h-7 w-20 shrink-0 rounded-lg" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
