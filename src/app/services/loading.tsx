// src/app/services/loading.tsx
/**
 * @file loading.tsx
 * @description Streaming skeleton for the services page: heading card, the
 * "what I help with" card with its service-area grid, the home/business pair
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
          className={cn("flex flex-col gap-6 sm:gap-8")}
          role="status"
          aria-live="polite"
          aria-label="Loading services page"
        >
          {/* Heading card */}
          <section className={cn(CARD)}>
            <Bone className={cn("mb-4 h-9 w-48 sm:h-10")} />
            <Bone className={cn("mb-2 h-5 w-full")} />
            <Bone className={cn("h-5 w-3/4")} />
          </section>

          {/* Service-area grid */}
          <section className={cn(CARD)}>
            <Bone className={cn("mb-3 h-7 w-44")} />
            <div
              className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4")}
            >
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "border-seasalt-400/60 bg-seasalt-800 rounded-lg border p-3 shadow-sm",
                  )}
                >
                  <div className={cn("mb-2 flex items-center gap-2")}>
                    <Bone className={cn("size-10 shrink-0 rounded-lg")} />
                    <Bone className={cn("h-6 flex-1")} />
                  </div>
                  <div className={cn("flex flex-col gap-1.5")}>
                    {Array.from({ length: 4 }).map((_, j) => (
                      <Bone key={j} className={cn("h-4 w-full")} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <Bone className={cn("mt-6 h-5 w-full max-w-lg")} />
          </section>

          {/* Home / business pair */}
          <div className={cn("grid gap-5 md:grid-cols-2")}>
            {Array.from({ length: 2 }).map((_, i) => (
              <section key={i} className={cn(CARD)}>
                <Bone className={cn("mb-3 h-7 w-40")} />
                <Bone className={cn("mb-3 h-5 w-56 max-w-full")} />
                <div className={cn("flex flex-col gap-2")}>
                  {Array.from({ length: 5 }).map((_, j) => (
                    <div key={j} className={cn("flex gap-2")}>
                      <Bone className={cn("mt-1 size-3 shrink-0 rounded-full")} />
                      <Bone className={cn("h-5 flex-1")} />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {/* CTA */}
          <section className={cn(CARD, "flex flex-col items-center text-center")}>
            <Bone className={cn("mb-4 h-5 w-44")} />
            <div className={cn("flex flex-wrap items-center justify-center gap-3")}>
              <Bone className={cn("h-10 w-32 rounded-xl")} />
              <Bone className={cn("h-10 w-32 rounded-xl")} />
            </div>
          </section>

          <span className={cn("sr-only")}>Loading services page...</span>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
