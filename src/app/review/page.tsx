// src/app/review/page.tsx
/**
 * @file page.tsx
 * @description Protected review page - requires token OR allows public reviews.
 */

import ReviewFormProtected from "@/features/reviews/components/ReviewForm";
import { Button } from "@/shared/components/Button";
import { CARD, FrostedSection, PageShell } from "@/shared/components/PageLayout";
import { cn } from "@/shared/lib/cn";
import { prisma } from "@/shared/lib/prisma";
import type { Metadata } from "next";
import Link from "next/link";
import type React from "react";

// This page reads searchParams so it is always dynamic - revalidate has no effect.
export const dynamic = "force-dynamic";

// Token-gated form, not a landing page: keep it out of search results.
export const metadata: Metadata = {
  title: "Leave a review",
  robots: { index: false, follow: false },
};

/**
 * Review page with optional token-based protection
 * @param props - Page props
 * @param props.searchParams - URL search params
 * @returns Review page element
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const tokenValue = params.token;
  const token = Array.isArray(tokenValue) ? tokenValue[0] : tokenValue;

  let sourceId: string | null = null;
  let sourceType: "booking" | "contact" | null = null;
  let prefillName: string | null = null;
  let prefillEmail: string | null = null;
  let prefillPhone: string | null = null;
  let tokenValid = false;
  let alreadyReviewed = false;
  let existingReview: {
    id: string;
    text: string;
    firstName: string | null;
    lastName: string | null;
    isAnonymous: boolean;
  } | null = null;

  // If token provided, validate against both Booking and Contact in parallel
  if (token) {
    const [booking, contact, maybeExistingReview] = await Promise.all([
      prisma.booking.findFirst({
        where: { reviewToken: token },
        select: { id: true, name: true, email: true, reviewSubmittedAt: true },
      }),
      prisma.contact.findFirst({
        where: { reviewToken: token },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          reviewLinkSubmittedAt: true,
        },
      }),
      // Fetch speculatively - only used if the token maps to an already-reviewed source
      prisma.review.findFirst({
        where: { customerRef: token },
        select: { id: true, text: true, firstName: true, lastName: true, isAnonymous: true },
      }),
    ]);

    if (booking) {
      sourceId = booking.id;
      sourceType = "booking";
      prefillName = booking.name;
      prefillEmail = booking.email;
      tokenValid = true;
      alreadyReviewed = !!booking.reviewSubmittedAt;
    } else if (contact) {
      sourceId = contact.id;
      sourceType = "contact";
      prefillName = contact.name;
      prefillEmail = contact.email;
      prefillPhone = contact.phone;
      tokenValid = true;
      alreadyReviewed = !!contact.reviewLinkSubmittedAt;
    }

    if (tokenValid && alreadyReviewed) {
      existingReview = maybeExistingReview;
    }
  }

  return (
    <PageShell>
      <FrostedSection maxWidth="56rem">
        <div className={cn("flex flex-col gap-4 sm:gap-5")}>
          {/* Token invalid warning */}
          {token && !tokenValid && (
            <section className={cn(CARD)}>
              <h1
                className={cn(
                  "mb-2 text-2xl font-extrabold text-russian-violet sm:text-3xl md:text-4xl",
                )}
              >
                Invalid Review Link
              </h1>
              <p className={cn("mb-4 text-base text-rich-black/80")}>
                This review link is invalid or has expired. If you recently had an appointment,
                please check your email for the correct link.
              </p>
              <Button href="/" variant="secondary" size="sm">
                Back to home
              </Button>
            </section>
          )}

          {/* Valid token - new or editing existing review */}
          {tokenValid && (
            <>
              <section className={cn(CARD)}>
                <h1
                  className={cn(
                    "mb-2 text-2xl font-extrabold text-russian-violet sm:text-3xl md:text-4xl",
                  )}
                >
                  {alreadyReviewed ? "Edit your review" : "How was your appointment?"}
                </h1>
                <p className={cn("text-base text-rich-black/80")}>
                  {alreadyReviewed
                    ? `Hi ${prefillName}! You can update your review any time using this link.`
                    : `Hi ${prefillName}! Thanks for choosing To The Point Tech. I'd love to hear about your experience.`}
                </p>
              </section>

              <section className={cn(CARD)}>
                <ReviewFormProtected
                  bookingId={sourceType === "booking" ? sourceId! : undefined}
                  contactId={sourceType === "contact" ? sourceId! : undefined}
                  token={token!}
                  prefillName={prefillName!}
                  prefillEmail={prefillEmail ?? undefined}
                  prefillPhone={prefillPhone ?? undefined}
                  existingReview={existingReview ?? undefined}
                />
              </section>
            </>
          )}

          {/* No token - show message */}
          {!token && (
            <section className={cn(CARD)}>
              <h1
                className={cn(
                  "mb-2 text-2xl font-extrabold text-russian-violet sm:text-3xl md:text-4xl",
                )}
              >
                Review Link Required
              </h1>
              <p className={cn("mb-4 text-base text-rich-black/80")}>
                To leave a review, please use the personalized review link sent to your email after
                your appointment.
              </p>
              <p className={cn("mb-4 text-base text-rich-black/80")}>
                This helps ensure all reviews are from verified customers. If you can't find your
                review link, feel free to{" "}
                <Link href="/contact" className={cn("text-coquelicot-500 hover:underline")}>
                  get in touch
                </Link>
                .
              </p>
              <Button href="/" variant="secondary" size="sm">
                Back to home
              </Button>
            </section>
          )}
        </div>
      </FrostedSection>
    </PageShell>
  );
}
