// src/app/(email-previews)/page.tsx
/**
 * @file page.tsx
 * @description Dev-only email preview placeholder so the project compiles.
 */

import type React from "react";
import { FrostedSection, PageShell } from "@/components/PageLayout";
import { cn } from "@/lib/cn";

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
          className={cn("mx-auto flex w-full max-w-5xl flex-col gap-6 pb-6 pt-4 sm:pb-8 sm:pt-6")}
        >
          <section
            className={cn(
              "border-seasalt-400/60 bg-seasalt-800 rounded-xl border p-4 shadow-sm sm:p-6",
            )}
          >
            <h1
              className={cn(
                "text-russian-violet mb-2 text-2xl font-extrabold sm:text-3xl md:text-4xl",
              )}
            >
              Email previews
            </h1>
            <p className={cn("text-rich-black/80 text-sm sm:text-base")}>
              Email templates are not configured in this build.
            </p>
          </section>
        </main>
      </FrostedSection>
    </PageShell>
  );
}
