// src/app/unsubscribe/[token]/page.tsx
// Public page behind the unsubscribe link in every mailing-list email. Checks the
// signed token, then leaves the actual change to a button press.

import { UnsubscribeForm } from "@/features/mailing/components/UnsubscribeForm";
import { isContactOptedOut } from "@/features/mailing/lib/opt-out";
import { verifyUnsubscribeToken } from "@/features/mailing/lib/unsubscribe-token";
import { CARD, FrostedSection, PageShell } from "@/shared/components/PageLayout";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
};

/**
 * Unsubscribe page.
 * @param props - Page props.
 * @param props.params - Route params with the signed token.
 * @returns Unsubscribe page element.
 */
export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<React.ReactElement> {
  const { token } = await params;
  const isPreview = token === "preview";
  const contactId = isPreview ? null : verifyUnsubscribeToken(token);
  const alreadyOut = contactId ? await isContactOptedOut(contactId) : false;

  return (
    <PageShell>
      <FrostedSection maxWidth="40rem">
        <section className={CARD}>
          <h1 className="mb-4 text-2xl font-extrabold text-russian-violet sm:text-3xl">
            Unsubscribe
          </h1>
          {isPreview && (
            <p className="text-base text-rich-black/80">
              This is the unsubscribe link from a test email, so there&apos;s nothing to change. In
              a real email, this page has a button that takes the person off the list.
            </p>
          )}
          {!isPreview && !contactId && (
            <p className="text-base text-rich-black/80">
              This link doesn&apos;t look right - it may have been cut short when it was copied. Try
              clicking it straight from the email, or just reply to the email and say you&apos;d
              like to stop getting them.
            </p>
          )}
          {contactId && <UnsubscribeForm token={token} initiallyUnsubscribed={alreadyOut} />}
        </section>
      </FrostedSection>
    </PageShell>
  );
}
