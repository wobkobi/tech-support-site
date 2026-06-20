// src/app/reviews/page.tsx
/**
 * @file page.tsx
 * @description Public reviews page showing all approved client reviews.
 */

import { ReviewScrollHandler } from "@/features/reviews/components/ReviewScrollHandler";
import { formatReviewerName } from "@/features/reviews/lib/formatting";
import { splitReviewsIntoColumns } from "@/features/reviews/lib/gridColumns";
import { BreadcrumbJsonLd } from "@/shared/components/BreadcrumbJsonLd";
import { CARD, FrostedSection, PageShell } from "@/shared/components/PageLayout";
import { cn } from "@/shared/lib/cn";
import { prisma } from "@/shared/lib/prisma";
import type { Metadata } from "next";
import Link from "next/link";
import type React from "react";

export const metadata: Metadata = {
  title: "Reviews - What Auckland Clients Say About To The Point Tech",
  description:
    "Real reviews from Auckland clients who have used To The Point Tech for computer repair, Wi-Fi setup, virus removal, smart home, and small-business IT support.",
  alternates: { canonical: "/reviews" },
  openGraph: {
    title: "Reviews - To The Point Tech",
    description: "Feedback from clients across Auckland.",
    url: "/reviews",
  },
};

// Rely on on-demand revalidation (triggered by admin approve/delete/submit).
// Long fallback avoids waking a cold DB on a fixed timer.
export const revalidate = 86400;

const linkStyle =
  "text-coquelicot-500 hover:text-coquelicot-600 underline-offset-4 hover:underline";

/**
 * Reviews page component.
 * @returns Reviews page element.
 */
export default async function ReviewsPage(): Promise<React.ReactElement> {
  const rows = await prisma.review.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      text: true,
      firstName: true,
      lastName: true,
      isAnonymous: true,
    },
    where: { status: "approved" },
  });

  const normalisedRows = rows.map((r) => ({
    ...r,
    text: r.text.trim().replace(/\s+/g, " "),
    firstName: r.firstName?.trim() || null,
    lastName: r.lastName?.trim() || null,
  }));

  // Balance reviews into two columns so the masonry grid packs with no gaps.
  const reviewColumns = splitReviewsIntoColumns(normalisedRows);

  return (
    <PageShell>
      <ReviewScrollHandler />
      <BreadcrumbJsonLd
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Reviews", path: "/reviews" },
        ]}
      />
      <FrostedSection>
        <div className="flex flex-col gap-6 sm:gap-8">
          <section aria-labelledby="reviews-heading" className={cn(CARD, "animate-fade-in")}>
            <h1
              id="reviews-heading"
              className="mb-4 text-2xl font-extrabold text-russian-violet sm:text-3xl md:text-4xl"
            >
              What clients say
            </h1>
            <p className="text-base text-rich-black/80 sm:text-lg">
              Feedback from people I've helped.
            </p>
          </section>

          {rows.length === 0 ? (
            <section
              aria-labelledby="no-reviews-heading"
              className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-100")}
            >
              <h2
                id="no-reviews-heading"
                className="mb-2 text-xl font-bold text-russian-violet sm:text-2xl"
              >
                No reviews yet
              </h2>
              <p className="text-base text-rich-black/70 sm:text-lg">
                Be the first!{" "}
                <Link href="/booking" className={linkStyle}>
                  Book an appointment
                </Link>{" "}
                and you'll get a review link after your visit.
              </p>
            </section>
          ) : (
            <section
              aria-label="Client reviews"
              className="animate-slide-up animate-fill-both animate-delay-100"
            >
              {/* Two balanced masonry columns (see splitReviewsIntoColumns). On mobile both
                  <ul>s collapse via display:contents into one flex column, where the CSS
                  `order` (date index) restores a single newest-first list. */}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                {[reviewColumns.left, reviewColumns.right].map((column, columnIndex) => (
                  <ul key={columnIndex} className="contents sm:flex sm:flex-1 sm:flex-col sm:gap-4">
                    {column.map(({ review: r, order }) => (
                      <li
                        key={r.id}
                        id={`review-${r.id}`}
                        style={{ order }}
                        className="flex flex-col rounded-lg border-2 border-seasalt-400/60 bg-seasalt-800/80 p-4 sm:p-5"
                      >
                        <p className="text-base text-rich-black sm:text-lg">{r.text}</p>
                        <p className="pt-3 text-right text-base font-semibold text-russian-violet sm:text-lg">
                          - {formatReviewerName(r)}
                        </p>
                      </li>
                    ))}
                  </ul>
                ))}
              </div>
            </section>
          )}

          <section
            aria-label="Leave a review"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-200")}
          >
            <p className="text-base text-rich-black sm:text-lg">
              Had an appointment? You'll receive a review link by email after your visit. Or{" "}
              <Link href="/booking" className={linkStyle}>
                book now
              </Link>{" "}
              to get started.
            </p>
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
