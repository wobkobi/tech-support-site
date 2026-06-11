// src/app/contact/loading.tsx
/**
 * @file loading.tsx
 * @description Streaming skeleton for the contact page: centred heading with
 * call/email buttons, service-area card, what-to-include list and a CTA card.
 */

import { CARD, FrostedSection, PageShell } from "@/shared/components/PageLayout";
import { Bone } from "@/shared/components/Skeleton";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/**
 * Contact route-loading skeleton.
 * @returns Skeleton element.
 */
export default function ContactLoading(): React.ReactElement {
  return (
    <PageShell>
      <FrostedSection>
        <div
          className={cn("flex flex-col gap-6 sm:gap-8")}
          role="status"
          aria-live="polite"
          aria-label="Loading contact page"
        >
          {/* Heading + contact buttons */}
          <section className={cn(CARD, "flex flex-col items-center text-center")}>
            <Bone className={cn("mb-4 h-9 w-64 sm:h-10")} />
            <Bone className={cn("mb-8 h-5 w-full max-w-2xl")} />
            <div
              className={cn(
                "flex w-full flex-col items-center gap-4 sm:flex-row sm:justify-center",
              )}
            >
              <Bone className={cn("h-12 w-full rounded-xl sm:w-48")} />
              <Bone className={cn("h-12 w-full rounded-xl sm:w-44")} />
            </div>
            <Bone className={cn("mt-6 h-5 w-72 max-w-full")} />
          </section>

          {/* Service area (icon + text) */}
          <section className={cn(CARD)}>
            <div className={cn("flex items-start gap-4")}>
              <Bone className={cn("size-12 shrink-0 rounded-lg sm:size-14")} />
              <div className={cn("flex-1")}>
                <Bone className={cn("mb-3 h-7 w-40")} />
                <Bone className={cn("mb-2 h-5 w-56 max-w-full")} />
                <Bone className={cn("h-5 w-full max-w-md")} />
              </div>
            </div>
          </section>

          {/* What to include (bullet list) */}
          <section className={cn(CARD)}>
            <Bone className={cn("mb-4 h-7 w-80 max-w-full")} />
            <Bone className={cn("mb-4 h-5 w-full max-w-lg")} />
            <div className={cn("flex flex-col gap-3")}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className={cn("flex gap-3")}>
                  <Bone className={cn("mt-1 size-4 shrink-0 rounded-full")} />
                  <Bone className={cn("h-5 max-w-md flex-1")} />
                </div>
              ))}
            </div>
          </section>

          {/* CTA */}
          <section className={cn(CARD, "flex flex-col items-center text-center")}>
            <Bone className={cn("mb-4 h-5 w-48")} />
            <Bone className={cn("h-10 w-52 rounded-xl")} />
          </section>

          <span className={cn("sr-only")}>Loading contact page...</span>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
