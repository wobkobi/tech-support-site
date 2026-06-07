// src/app/review/loading.tsx
/**
 * @file loading.tsx
 * @description Streaming skeleton for the review page.
 * Shown immediately while the server validates the token and fetches review data.
 * Turns a 6s FCP into a near-instant render by streaming the shell first.
 */

import { PageShell, FrostedSection, CARD } from "@/shared/components/PageLayout";
import { cn } from "@/shared/lib/cn";
import { Bone } from "@/shared/components/Skeleton";

/**
 * Review page loading skeleton shown via React Suspense while DB queries run.
 * @returns Loading skeleton element.
 */
export default function ReviewLoading(): React.ReactElement {
  return (
    <PageShell>
      <FrostedSection maxWidth="56rem">
        <div className={cn("flex flex-col gap-4 sm:gap-5")}>
          {/* Heading card skeleton */}
          <section className={cn(CARD)}>
            <Bone className={cn("mb-3 h-9 w-72 sm:w-96")} />
            <Bone className={cn("h-5 w-64 opacity-70 sm:w-80")} />
          </section>

          {/* Form card skeleton */}
          <section className={cn(CARD)}>
            <div className={cn("space-y-4")}>
              <Bone className={cn("h-10 w-full")} />
              <Bone className={cn("h-10 w-full")} />
              <Bone className={cn("h-28 w-full")} />
              <Bone className={cn("h-10 w-32 rounded-xl")} />
            </div>
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
