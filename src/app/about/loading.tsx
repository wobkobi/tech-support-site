// src/app/about/loading.tsx
/**
 * @description Streaming skeleton for the about page: a heading card plus the
 * approach and "Who I help" list cards.
 */

import { CARD } from "@/shared/components/PageLayout";
import { PageLoadingShell } from "@/shared/components/PageLoadingShell";
import { Bone } from "@/shared/components/Skeleton";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/**
 * About route-loading skeleton.
 * @returns Skeleton element.
 */
export default function AboutLoading(): React.ReactElement {
  return (
    <PageLoadingShell label="about page">
      {/* Heading card */}
      <section className={cn(CARD)}>
        <Bone className="mb-4 h-9 w-80 max-w-full sm:h-10" />
        <Bone className="mb-2 h-5 w-full" />
        <Bone className="h-5 w-3/4" />
      </section>

      {/* Two list cards (4 rows then 3 rows). */}
      {[4, 3].map((rows, idx) => (
        <section key={idx} className={cn(CARD)}>
          <Bone className="mb-4 h-7 w-44" />
          <div className="flex flex-col gap-3">
            {Array.from({ length: rows }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <Bone className="mt-1 size-4 shrink-0 rounded-full" />
                <Bone className="h-5 flex-1" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </PageLoadingShell>
  );
}
