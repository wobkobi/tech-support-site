// src/app/resubscribe/[token]/page.tsx
// Public page behind the button in the "Do you want my emails again?" email. Checks the
// signed token, then leaves the actual change to a button press.

import { followMerges } from "@/features/contacts/lib/merge-links";
import { ResubscribeForm } from "@/features/mailing/components/ResubscribeForm";
import { isContactOptedOut } from "@/features/mailing/lib/opt-out";
import { verifyUnsubscribeToken } from "@/features/mailing/lib/unsubscribe-token";
import { CARD, CardPage } from "@/shared/components/PageLayout";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Get my emails again",
  robots: { index: false, follow: false },
};

/**
 * Resubscribe confirm page.
 * @param props - Page props.
 * @param props.params - Route params with the signed token.
 * @returns Resubscribe page element.
 */
export default async function ResubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<React.ReactElement> {
  const { token } = await params;
  const tokenId = verifyUnsubscribeToken(token);
  const contactId = tokenId ? await followMerges(tokenId) : null;
  const onList = contactId ? !(await isContactOptedOut(contactId)) : false;

  return (
    <CardPage maxWidth="40rem">
      <section className={CARD}>
        <h1 className="mb-4 text-2xl font-extrabold text-russian-violet sm:text-3xl">
          Get my emails again
        </h1>
        {!contactId && (
          <p className="text-base text-rich-black/80">
            This link doesn&apos;t look right - it may have been cut short when it was copied. Try
            pressing the button straight from the email, or just reply to the email and say
            you&apos;d like my emails again.
          </p>
        )}
        {contactId && <ResubscribeForm token={token} initiallyOnList={onList} />}
      </section>
    </CardPage>
  );
}
