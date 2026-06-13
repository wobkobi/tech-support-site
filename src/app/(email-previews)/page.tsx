// src/app/(email-previews)/page.tsx
/**
 * @file page.tsx
 * @description Dev-only email preview placeholder so the project compiles.
 */

import { FrostedSection, PageShell } from "@/shared/components/PageLayout";
import { cn } from "@/shared/lib/cn";
import type React from "react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Placeholder page for email template previews.
 * @returns Email previews page element.
 */
export default function EmailPreviewsPage(): React.ReactElement {
  return (
    <PageShell>
      <FrostedSection>
        <main
          className={cn("mx-auto flex w-full max-w-5xl flex-col gap-6 pt-4 pb-6 sm:pt-6 sm:pb-8")}
        >
          <section
            className={cn(
              "rounded-xl border border-seasalt-400/60 bg-seasalt-800 p-4 shadow-sm sm:p-6",
            )}
          >
            <h1
              className={cn(
                "mb-2 text-2xl font-extrabold text-russian-violet sm:text-3xl md:text-4xl",
              )}
            >
              Email previews
            </h1>
            <p className={cn("text-sm text-rich-black/80 sm:text-base")}>
              Email templates are not configured in this build.
            </p>
          </section>
        </main>
      </FrostedSection>
    </PageShell>
  );
}
