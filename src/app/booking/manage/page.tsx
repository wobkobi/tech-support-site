// src/app/booking/manage/page.tsx
/**
 * @description Find-my-booking page. Customers who have lost the confirmation
 * email can have their change / cancel links re-sent to the address they booked
 * with, without needing the token.
 */

import { CARD, FrostedSection, PageShell } from "@/shared/components/PageLayout";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { cn } from "@/shared/lib/cn";
import type { Metadata } from "next";
import type React from "react";
import { ManageLookupForm } from "./ManageLookupForm";

export const metadata: Metadata = {
  title: "Manage your booking",
  description:
    "Lost your confirmation email? Enter the address you booked with and we'll re-send the links to change or cancel your appointment.",
  alternates: { canonical: "/booking/manage" },
  openGraph: {
    title: "Manage your booking - To the Point Tech",
    description: "Re-send the links to change or cancel your appointment.",
    url: "/booking/manage",
  },
};

/**
 * Find-my-booking page.
 * @returns The page element.
 */
export default async function ManageBookingPage(): Promise<React.ReactElement> {
  // Phone comes from the live identity settings, not hardcoded copy.
  const identity = await getIdentity();

  return (
    <PageShell>
      <FrostedSection maxWidth="min(100vw - 2rem, 44rem)">
        <div className="flex flex-col gap-6 sm:gap-8">
          <section className={cn(CARD)}>
            <h1 className="mb-3 text-2xl font-extrabold text-russian-violet sm:text-3xl md:text-4xl">
              Manage your booking
            </h1>
            <p className="text-base text-rich-black/80 sm:text-lg">
              Lost the confirmation email? Pop your email address in below and I'll send the links
              to change or cancel your appointment straight back to you.
            </p>
          </section>

          <section className={cn(CARD)}>
            <ManageLookupForm phone={identity.phone} phoneTel={identity.phoneTel} />
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
