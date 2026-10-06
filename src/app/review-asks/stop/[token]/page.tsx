// src/app/review-asks/stop/[token]/page.tsx
// Public page behind the "Stop asking me for reviews" link in every review-ask email.
// Checks the signed token, then leaves the actual change to a button press.

import { verifyReviewAskStopToken } from "@/features/mailing/lib/unsubscribe-token";
import { ReviewAskStopForm } from "@/features/reviews/components/ReviewAskStopForm";
import { isReviewAskOptedOut } from "@/features/reviews/lib/review-ask-opt-out";
import { CARD, FrostedSection, PageShell } from "@/shared/components/PageLayout";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Review requests",
  robots: { index: false, follow: false },
};

/**
 * Stop-review-asks page.
 * @param props - Page props.
 * @param props.params - Route params with the signed token.
 * @returns Page element.
 */
export default async function ReviewAskStopPage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<React.ReactElement> {
  const { token } = await params;
  const isPreview = token === "preview";
  const contactId = isPreview ? null : verifyReviewAskStopToken(token);
  const alreadyStopped = contactId ? await isReviewAskOptedOut(contactId) : false;

  return (
    <PageShell>
      <FrostedSection maxWidth="40rem">
        <section className={CARD}>
          <h1 className="mb-4 text-2xl font-extrabold text-russian-violet sm:text-3xl">
            Review requests
          </h1>
          {isPreview && (
            <p className="text-base text-rich-black/80">
              This is the link from a preview email, so there&apos;s nothing to change. In a real
              email, this page has a button that stops review requests for that person.
            </p>
          )}
          {!isPreview && !contactId && (
            <p className="text-base text-rich-black/80">
              This link doesn&apos;t look right - it may have been cut short when it was copied. Try
              clicking it straight from the email, or just reply to the email and say you&apos;d
              like me to stop asking.
            </p>
          )}
          {contactId && <ReviewAskStopForm token={token} initiallyStopped={alreadyStopped} />}
        </section>
      </FrostedSection>
    </PageShell>
  );
}
