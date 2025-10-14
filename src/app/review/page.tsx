// src/app/review/page.tsx
/**
 * User feedback review page variant:
 * - Consistent with main page: PageShell + FrostedSection
 * - Standard card sizes and spacing
 */

import ReviewForm from "@/components/ReviewForm";
import { FrostedSection, PageShell } from "@/components/SiteFrame";
import { cn } from "@/lib/cn";

/**
 * Reviews submission page.
 * @returns Reviews page element.
 */
export default function ReviewsPage(): React.ReactElement {
  return (
    <PageShell>
      <FrostedSection>
        <section className={cn("mx-auto w-full max-w-5xl")}>
          <h1
            className={cn(
              "text-rich-black mb-3 text-center text-2xl font-bold sm:mb-4 sm:text-3xl md:text-4xl"
            )}>
            Leave a Review
          </h1>

          <div
            className={cn(
              "border-seasalt-400/60 bg-seasalt-800 rounded-lg border p-4 shadow-sm sm:p-6"
            )}>
            <ReviewForm />
          </div>
        </section>
      </FrostedSection>
    </PageShell>
  );
}
