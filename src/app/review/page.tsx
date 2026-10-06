// src/app/review/page.tsx
// The review page a review ask links to. Leads with the Google review button; the site's
// own form (token-gated) sits behind "No Google account?", or opens straight away with
// ?form=1 (the email's fallback link). With no Google URL set, it's the site form alone.

import ReviewFormProtected from "@/features/reviews/components/ReviewForm";
import { Button } from "@/shared/components/Button";
import { CARD, FrostedSection, PageShell } from "@/shared/components/PageLayout";
import { PhoneLink } from "@/shared/components/PhoneLink";
import { cn } from "@/shared/lib/cn";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
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
 * The Google review button and the note under it.
 * @param props - Component props.
 * @param props.url - Google "write a review" link.
 * @param props.label - Button text.
 * @returns Button with its note.
 */
function GoogleReviewButton({ url, label }: { url: string; label: string }): React.ReactElement {
  return (
    <div className="space-y-2">
      <Button href={url} target="_blank" variant="primary" size="md">
        {label}
      </Button>
      <p className="text-base text-rich-black/70">
        Opens Google in a new tab. Reviews there show the name on your Google account.
      </p>
    </div>
  );
}

/**
 * Review page: Google first, with the token-gated site form as the fallback.
 * @param props - Page props
 * @param props.searchParams - URL search params; `token` identifies the customer and
 *   `form=1` opens the site form straight away.
 * @returns Review page element
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const [params, { identity, reviews }] = await Promise.all([searchParams, getSettings()]);
  const tokenValue = params.token;
  const token = Array.isArray(tokenValue) ? tokenValue[0] : tokenValue;
  const formValue = Array.isArray(params.form) ? params.form[0] : params.form;
  const openForm = formValue === "1";
  const googleUrl = reviews.googleReviewUrl.trim() || null;

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

  // If token provided, validate against both Booking and Contact in parallel.
  // The contact lookup accepts the primary reviewToken OR an inherited alt
  // token (folded in by contact merges) and prefers the live contact, so a
  // link sent before a merge still resolves to the surviving person.
  if (token) {
    const contactSelect = {
      id: true,
      name: true,
      email: true,
      phone: true,
      reviewLinkSubmittedAt: true,
    } as const;
    const [booking, liveContact, maybeExistingReview] = await Promise.all([
      prisma.booking.findFirst({
        where: { reviewToken: token },
        select: { id: true, name: true, email: true, reviewSubmittedAt: true },
      }),
      prisma.contact.findFirst({
        where: {
          OR: [{ reviewToken: token }, { altReviewTokens: { has: token } }],
          deletedAt: null,
        },
        select: contactSelect,
      }),
      // Fetch speculatively - only used if the token maps to an already-reviewed source
      prisma.review.findFirst({
        where: { customerRef: token },
        select: { id: true, text: true, firstName: true, lastName: true, isAnonymous: true },
      }),
    ]);
    // Legacy fallback: a soft-deleted contact whose token was never folded into
    // a live one still renders (submission handles the orphan case).
    const contact =
      liveContact ??
      (await prisma.contact.findFirst({ where: { reviewToken: token }, select: contactSelect }));

    if (booking) {
      sourceId = booking.id;
      sourceType = "booking";
      prefillName = booking.name;
      prefillEmail = booking.email;
      tokenValid = true;
      alreadyReviewed = !!booking.reviewSubmittedAt;
      if (alreadyReviewed) existingReview = maybeExistingReview;
    } else if (contact) {
      sourceId = contact.id;
      sourceType = "contact";
      prefillName = contact.name;
      prefillEmail = contact.email;
      prefillPhone = contact.phone;
      tokenValid = true;
      // Mirror POST's one-review-per-contactId guard: a review left via a BOOKING link
      // sets Review.contactId but not Contact.reviewLinkSubmittedAt, so keying off that
      // flag alone would render a create form POST then 409s. Keyed by contactId, not by
      // token, so the existing review is found (and editable) through any of their links.
      const contactReview =
        maybeExistingReview ??
        (await prisma.review.findFirst({
          where: { contactId: contact.id },
          orderBy: { createdAt: "desc" },
          select: { id: true, text: true, firstName: true, lastName: true, isAnonymous: true },
        }));
      alreadyReviewed = !!contact.reviewLinkSubmittedAt || !!contactReview;
      if (alreadyReviewed) existingReview = contactReview;
    }
  }

  return (
    <PageShell>
      <FrostedSection maxWidth="56rem">
        <div className="flex flex-col gap-4 sm:gap-5">
          {/* Token invalid warning */}
          {token && !tokenValid && (
            <section className={cn(CARD)}>
              <h1 className="mb-2 text-2xl font-extrabold text-russian-violet sm:text-3xl md:text-4xl">
                Invalid review link
              </h1>
              <p className="mb-4 text-base text-rich-black/80">
                This review link is invalid or has expired. If you recently had an appointment,
                please check your email for the correct link, or call or text me on{" "}
                <PhoneLink phone={identity.phone} phoneTel={identity.phoneTel} /> and I'll send you
                a fresh one.
              </p>
              {googleUrl && (
                <div className="mb-4 space-y-3">
                  <p className="text-base text-rich-black/80">
                    Or leave a review on Google - that doesn&apos;t need a link from me.
                  </p>
                  <GoogleReviewButton url={googleUrl} label="Leave a review on Google" />
                </div>
              )}
              <Button href="/" variant="secondary" size="md">
                Back to home
              </Button>
            </section>
          )}

          {/* Valid token, Google URL set, no review yet: Google first, site form folded */}
          {tokenValid && !alreadyReviewed && googleUrl && (
            <>
              <section className={cn(CARD)}>
                <h1 className="mb-2 text-2xl font-extrabold text-russian-violet sm:text-3xl md:text-4xl">
                  How was your appointment?
                </h1>
                <p className="mb-4 text-base text-rich-black/80">
                  Hi {prefillName}! Thanks for choosing To the Point Tech. If you&apos;ve got a
                  minute, a review on Google is the biggest help - it&apos;s where most people look
                  for local tech help.
                </p>
                <GoogleReviewButton url={googleUrl} label="Leave a review on Google" />
              </section>

              <details open={openForm} className={cn(CARD)}>
                <summary className="cursor-pointer text-base font-semibold text-russian-violet underline underline-offset-2 hover:opacity-80">
                  No Google account? Leave it here instead
                </summary>
                <div className="mt-4">
                  <ReviewFormProtected
                    bookingId={sourceType === "booking" ? sourceId! : undefined}
                    contactId={sourceType === "contact" ? sourceId! : undefined}
                    token={token}
                    prefillName={prefillName!}
                    prefillEmail={prefillEmail ?? undefined}
                    prefillPhone={prefillPhone ?? undefined}
                    phone={identity.phone}
                    phoneTel={identity.phoneTel}
                    googleReviewUrl={googleUrl}
                  />
                </div>
              </details>
            </>
          )}

          {/* Valid token otherwise: editing an existing review, or no Google URL set */}
          {tokenValid && (alreadyReviewed || !googleUrl) && (
            <>
              <section className={cn(CARD)}>
                <h1 className="mb-2 text-2xl font-extrabold text-russian-violet sm:text-3xl md:text-4xl">
                  {alreadyReviewed ? "Edit your review" : "How was your appointment?"}
                </h1>
                <p className="text-base text-rich-black/80">
                  {alreadyReviewed
                    ? `Hi ${prefillName}! You can update your review any time using this link.`
                    : `Hi ${prefillName}! Thanks for choosing To the Point Tech. I'd love to hear about your experience.`}
                </p>
              </section>

              {/* Offered to every past reviewer, whatever they wrote: Google bans
                  asking only happy customers. */}
              {alreadyReviewed && googleUrl && (
                <section className={cn(CARD, "space-y-3")}>
                  <h2 className="text-xl font-bold text-russian-violet sm:text-2xl">
                    Could you post it on Google too?
                  </h2>
                  <p className="text-base text-rich-black/80">
                    Thanks for the review you left here. Google is where most people look for local
                    tech help, so a copy there makes a big difference.
                  </p>
                  <GoogleReviewButton url={googleUrl} label="Post it on Google" />
                </section>
              )}

              <section className={cn(CARD)}>
                <ReviewFormProtected
                  bookingId={sourceType === "booking" ? sourceId! : undefined}
                  contactId={sourceType === "contact" ? sourceId! : undefined}
                  token={token}
                  prefillName={prefillName!}
                  prefillEmail={prefillEmail ?? undefined}
                  prefillPhone={prefillPhone ?? undefined}
                  existingReview={existingReview ?? undefined}
                  phone={identity.phone}
                  phoneTel={identity.phoneTel}
                  googleReviewUrl={googleUrl ?? undefined}
                />
              </section>
            </>
          )}

          {/* No token - show message */}
          {!token && (
            <section className={cn(CARD)}>
              <h1 className="mb-2 text-2xl font-extrabold text-russian-violet sm:text-3xl md:text-4xl">
                {googleUrl ? "Leave a review" : "Review link required"}
              </h1>
              {googleUrl && (
                <div className="mb-6 space-y-3">
                  <p className="text-base text-rich-black/80">
                    The quickest way is on Google - no link needed, and it&apos;s where most people
                    look for local tech help.
                  </p>
                  <GoogleReviewButton url={googleUrl} label="Leave a review on Google" />
                </div>
              )}
              <p className="mb-4 text-base text-rich-black/80">
                {googleUrl
                  ? "To leave one on this site instead, use the personalised review link sent to your email after your appointment."
                  : "To leave a review, please use the personalised review link sent to your email after your appointment."}
              </p>
              <p className="mb-4 text-base text-rich-black/80">
                This helps ensure all reviews are from verified customers. If you can't find your
                review link, call or text me on{" "}
                <PhoneLink phone={identity.phone} phoneTel={identity.phoneTel} />, or{" "}
                <Link
                  href="/contact"
                  className="font-semibold text-russian-violet underline underline-offset-2 hover:opacity-80"
                >
                  send me a message
                </Link>
                , and I'll send you a fresh one.
              </p>
              <Button href="/" variant="secondary" size="md">
                Back to home
              </Button>
            </section>
          )}
        </div>
      </FrostedSection>
    </PageShell>
  );
}
