// src/app/review/page.tsx
/**
 * Review submission page.
 */

import type React from "react";
import Link from "next/link";
import ReviewForm from "@/components/ReviewForm";
import { FrostedSection, PageShell } from "@/components/SiteFrame";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const pageMain = cn(
  "mx-auto flex w-full max-w-5xl flex-col gap-6 sm:gap-8",
  "pt-4 sm:pt-6 pb-6 sm:pb-8",
);

const card = cn("border-seasalt-400/60 bg-seasalt-800 rounded-xl border p-4 shadow-sm sm:p-6");

const primaryBtn = cn(
  "bg-coquelicot-500 hover:bg-coquelicot-600 text-rich-black rounded-md px-4 py-2 text-sm font-semibold sm:text-base",
);
const secondaryBtn = cn(
  "border-seasalt-400/60 hover:bg-seasalt-900/40 text-rich-black rounded-md border px-4 py-2 text-sm font-semibold sm:text-base",
);

/**
 * Reviews submission page.
 * @returns Reviews page element.
 */
export default function ReviewsPage(): React.ReactElement {
  return (
    <PageShell>
      <FrostedSection>
        <main className={pageMain}>
          <section aria-labelledby="review-heading" className={card}>
            <h1
              id="review-heading"
              className={cn(
                "text-russian-violet mb-2 text-2xl font-extrabold sm:text-3xl md:text-4xl",
              )}
            >
              Leave a review
            </h1>
            <p className={cn("text-rich-black/80 max-w-3xl text-sm sm:text-base")}>
              If I helped you out, a short review makes a big difference.
            </p>
          </section>

          <section aria-label="Review form" className={card}>
            <ReviewForm />
          </section>

          <section aria-label="Alternative contact" className={card}>
            <p className={cn("text-rich-black mb-3 text-sm sm:text-base")}>
              Prefer to send feedback directly? Use the contact page and I will add it (with your
              permission).
            </p>

            <div className={cn("flex flex-wrap gap-3")}>
              <Link href="/contact" className={primaryBtn}>
                Contact
              </Link>
              <Link href="/" className={secondaryBtn}>
                Back to home
              </Link>
            </div>
          </section>
        </main>
      </FrostedSection>
    </PageShell>
  );
}
