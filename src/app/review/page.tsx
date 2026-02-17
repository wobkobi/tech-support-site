// src/app/review/page.tsx
/**
 * @file page.tsx
 * @description Protected review page - requires token OR allows public reviews.
 */

import type React from "react";
import Link from "next/link";
import ReviewFormProtected from "@/components/ReviewForm";
import { FrostedSection, PageShell, CARD } from "@/components/PageLayout";
import { cn } from "@/lib/cn";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

  let booking = null;
  let tokenValid = false;
  let alreadyReviewed = false;

  // If token provided, validate it
  if (token) {
    booking = await prisma.booking.findFirst({
      where: { reviewToken: token },
      select: {
        id: true,
        name: true,
        email: true,
        reviewSubmittedAt: true,
        status: true,
      },
    });

    if (booking) {
      tokenValid = true;
      alreadyReviewed = !!booking.reviewSubmittedAt;
    }
  }

  return (
    <PageShell>
      <FrostedSection maxWidth="48rem">
        <div className={cn("flex flex-col gap-4 sm:gap-5")}>
          {/* Token invalid warning */}
          {token && !tokenValid && (
            <section className={cn(CARD)}>
              <h1
                className={cn(
                  "text-russian-violet mb-2 text-2xl font-extrabold sm:text-3xl md:text-4xl",
                )}
              >
                Invalid Review Link
              </h1>
              <p className={cn("text-rich-black/80 mb-4 text-sm sm:text-base")}>
                This review link is invalid or has expired. If you recently had an appointment,
                please check your email for the correct link.
              </p>
              <Link
                href="/"
                className={cn(
                  "bg-russian-violet text-seasalt inline-block rounded-md px-4 py-2.5 text-sm font-semibold hover:brightness-110",
                )}
              >
                Back to home
              </Link>
            </section>
          )}

          {/* Already reviewed */}
          {tokenValid && alreadyReviewed && (
            <section className={cn(CARD)}>
              <h1
                className={cn(
                  "text-russian-violet mb-2 text-2xl font-extrabold sm:text-3xl md:text-4xl",
                )}
              >
                Thanks for your review!
              </h1>
              <p className={cn("text-rich-black/80 mb-4 text-sm sm:text-base")}>
                You've already submitted a review for this appointment. Thanks for your feedback!
              </p>
              <Link
                href="/"
                className={cn(
                  "bg-russian-violet text-seasalt inline-block rounded-md px-4 py-2.5 text-sm font-semibold hover:brightness-110",
                )}
              >
                Back to home
              </Link>
            </section>
          )}

          {/* Valid token, not yet reviewed */}
          {tokenValid && !alreadyReviewed && (
            <>
              <section className={cn(CARD)}>
                <h1
                  className={cn(
                    "text-russian-violet mb-2 text-2xl font-extrabold sm:text-3xl md:text-4xl",
                  )}
                >
                  How was your appointment?
                </h1>
                <p className={cn("text-rich-black/80 text-sm sm:text-base")}>
                  Hi {booking!.name}! Thanks for choosing To The Point Tech. I'd love to hear about
                  your experience.
                </p>
              </section>

              <section className={cn(CARD)}>
                <ReviewFormProtected
                  bookingId={booking!.id}
                  token={token!}
                  prefillName={booking!.name}
                />
              </section>
            </>
          )}

          {/* No token - show message */}
          {!token && (
            <section className={cn(CARD)}>
              <h1
                className={cn(
                  "text-russian-violet mb-2 text-2xl font-extrabold sm:text-3xl md:text-4xl",
                )}
              >
                Review Link Required
              </h1>
              <p className={cn("text-rich-black/80 mb-4 text-sm sm:text-base")}>
                To leave a review, please use the personalized review link sent to your email after
                your appointment.
              </p>
              <p className={cn("text-rich-black/80 mb-4 text-sm sm:text-base")}>
                This helps ensure all reviews are from verified customers. If you can't find your
                review link, feel free to{" "}
                <Link href="/contact" className={cn("text-coquelicot-500 hover:underline")}>
                  get in touch
                </Link>
                .
              </p>
              <Link
                href="/"
                className={cn(
                  "bg-russian-violet text-seasalt inline-block rounded-md px-4 py-2.5 text-sm font-semibold hover:brightness-110",
                )}
              >
                Back to home
              </Link>
            </section>
          )}
        </div>
      </FrostedSection>
    </PageShell>
  );
}
