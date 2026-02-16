// src/app/review/page.tsx
/**
 * Review submission page.
 */

import type React from "react";
import Link from "next/link";
import ReviewForm from "@/components/ReviewForm";
import { FrostedSection, PageShell, CARD } from "@/components/SiteFrame";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const primaryBtn = cn(
  "bg-coquelicot-500 hover:bg-coquelicot-600 text-rich-black rounded-md px-4 py-2.5 text-sm font-semibold sm:text-base",
);
const secondaryBtn = cn(
  "border-seasalt-400/60 hover:bg-seasalt-900/40 text-rich-black rounded-md border px-4 py-2.5 text-sm font-semibold sm:text-base",
);

/**
 * Review page component.
 * @returns Review page element.
 */
export default function ReviewPage(): React.ReactElement {
  return (
    <PageShell>
      <FrostedSection maxWidth="48rem">
        <div className={cn("flex flex-col gap-4 sm:gap-5")}>
          <section aria-labelledby="review-heading" className={cn(CARD)}>
            <h1
              id="review-heading"
              className={cn(
                "text-russian-violet mb-2 text-2xl font-extrabold sm:text-3xl md:text-4xl",
              )}
            >
              Leave a review
            </h1>
            <p className={cn("text-rich-black/80 text-sm sm:text-base")}>
              If I helped you out, a short review means a lot. It helps other people in the
              community find reliable tech support.
            </p>
          </section>

          <section aria-label="Review form" className={cn(CARD)}>
            <ReviewForm />
          </section>

          <section aria-label="Alternative" className={cn(CARD)}>
            <p className={cn("text-rich-black mb-3 text-sm sm:text-base")}>
              Prefer to send feedback privately? Use the contact page and I can add it (with your
              permission).
            </p>

            <div className={cn("flex flex-wrap gap-3")}>
              <Link href="/contact" className={primaryBtn}>
                Contact me
              </Link>
              <Link href="/" className={secondaryBtn}>
                Back to home
              </Link>
            </div>
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
