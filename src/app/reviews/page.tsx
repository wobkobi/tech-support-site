// src/app/reviews/page.tsx
/**
 * @file page.tsx
 * @description Public reviews page showing all approved client reviews.
 */

import type { Metadata } from "next";
import type React from "react";
import Link from "next/link";
import { FrostedSection, PageShell, CARD } from "@/shared/components/PageLayout";
import { BreadcrumbJsonLd } from "@/shared/components/BreadcrumbJsonLd";
import { cn } from "@/shared/lib/cn";
import { prisma } from "@/shared/lib/prisma";
import { formatReviewerName } from "@/features/reviews/lib/formatting";
import { ReviewScrollHandler } from "@/features/reviews/components/ReviewScrollHandler";

export const metadata: Metadata = {
  title: "Reviews - What Auckland Clients Say About To The Point Tech",
  description:
    "Real reviews from Auckland clients who have used To The Point Tech for computer repair, Wi-Fi setup, virus removal, smart home, and small-business IT support.",
  keywords: [
    "tech support reviews Auckland",
    "computer repair reviews Auckland",
    "IT support testimonials",
    "To The Point Tech reviews",
  ],
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

const linkStyle = cn(
  "text-coquelicot-500 hover:text-coquelicot-600 underline-offset-4 hover:underline",
);

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

  // Normalize whitespace in all reviews
  const normalizedRows = rows.map((r) => ({
    ...r,
    text: r.text.trim().replace(/\s+/g, " "),
    firstName: r.firstName?.trim() || null,
    lastName: r.lastName?.trim() || null,
  }));

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
        <div className={cn("flex flex-col gap-6 sm:gap-8")}>
          <section aria-labelledby="reviews-heading" className={cn(CARD, "animate-fade-in")}>
            <h1
              id="reviews-heading"
              className={cn(
                "text-russian-violet mb-4 text-2xl font-extrabold sm:text-3xl md:text-4xl",
              )}
            >
              What clients say
            </h1>
            <p className={cn("text-rich-black/80 text-base sm:text-lg")}>
              Feedback from people I&apos;ve helped.
            </p>
          </section>

          {rows.length === 0 ? (
            <section className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-100")}>
              <p className={cn("text-rich-black/70 text-base sm:text-lg")}>
                No reviews yet - be the first!{" "}
                <Link href="/booking" className={linkStyle}>
                  Book an appointment
                </Link>{" "}
                and you&apos;ll get a review link after your visit.
              </p>
            </section>
          ) : (
            <section
              aria-label="Client reviews"
              className={cn("animate-slide-up animate-fill-both animate-delay-100")}
            >
              <ul className={cn("grid gap-4 sm:grid-cols-2")}>
                {normalizedRows.map((r) => (
                  <li
                    key={r.id}
                    id={`review-${r.id}`}
                    className={cn(
                      "bg-seasalt-800/80 border-seasalt-400/60 flex flex-col rounded-lg border-2 p-4 sm:p-5",
                    )}
                  >
                    <p className={cn("text-rich-black flex-1 text-sm sm:text-base")}>{r.text}</p>
                    <p
                      className={cn(
                        "text-russian-violet pt-3 text-right text-sm font-semibold sm:text-base",
                      )}
                    >
                      - {formatReviewerName(r)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section
            aria-label="Leave a review"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-200")}
          >
            <p className={cn("text-rich-black text-sm sm:text-base")}>
              Had an appointment? You&apos;ll receive a review link by email after your visit. Or{" "}
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
