// src/app/services/loading.tsx
/**
 * @description Streaming skeleton for the services page: heading card, the
 * "What I help with" card with its service-area grid, the home/business pair
 * and the closing CTA. Shown while the live pricing lookup runs.
 */

import { CARD, FrostedSection, PageShell } from "@/shared/components/PageLayout";
import { Bone } from "@/shared/components/Skeleton";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/**
 * Services route-loading skeleton.
 * @returns Skeleton element.
 */
export default function ServicesLoading(): React.ReactElement {
  return (
    <PageShell>
      <FrostedSection>
        <div
          className="flex flex-col gap-6 sm:gap-8"
          role="status"
          aria-live="polite"
          aria-label="Loading services page"
        >
          {/* Heading card */}
          <section className={cn(CARD)}>
            <Bone className="mb-4 h-9 w-48 sm:h-10" />
            <Bone className="mb-2 h-5 w-full" />
            <Bone className="h-5 w-3/4" />
          </section>

          {/* Service-area grid */}
          <section className={cn(CARD)}>
            <Bone className="mb-3 h-7 w-44" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-seasalt-200/60 bg-white p-3 shadow-sm"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <Bone className="size-10 shrink-0 rounded-lg" />
                    <Bone className="h-6 flex-1" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {Array.from({ length: 4 }).map((_, j) => (
                      <Bone key={j} className="h-4 w-full" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <Bone className="mt-6 h-5 w-full max-w-lg" />
          </section>

          {/* Home / business pair */}
          <div className="grid gap-5 md:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <section key={i} className={cn(CARD)}>
                <Bone className="mb-3 h-7 w-40" />
                <Bone className="mb-3 h-5 w-56 max-w-full" />
                <div className="flex flex-col gap-2">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <div key={j} className="flex gap-2">
                      <Bone className="mt-1 size-3 shrink-0 rounded-full" />
                      <Bone className="h-5 flex-1" />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {/* CTA */}
          <section className={cn(CARD, "flex flex-col items-center text-center")}>
            <Bone className="mb-4 h-5 w-44" />
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Bone className="h-10 w-32 rounded-xl" />
              <Bone className="h-10 w-32 rounded-xl" />
            </div>
          </section>

          <span className="sr-only">Loading services page...</span>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
