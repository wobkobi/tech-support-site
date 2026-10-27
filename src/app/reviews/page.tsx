// src/app/reviews/page.tsx
// Public reviews page showing all approved client reviews.

import { ReviewScrollHandler } from "@/features/reviews/components/ReviewScrollHandler";
import { ReviewsList, type PublicReview } from "@/features/reviews/components/ReviewsList";
import { Button } from "@/shared/components/Button";
import { ClosingCta } from "@/shared/components/ClosingCta";
import { PageHead } from "@/shared/components/PageHead";
import { PageShell } from "@/shared/components/PageLayout";
import { Section, SectionHeading, TEXT_LINK } from "@/shared/components/Section";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { GOOGLE_BUSINESS_PROFILE_URL } from "@/shared/lib/business-profiles";
import { pageOpenGraph } from "@/shared/lib/open-graph";
import { prisma } from "@/shared/lib/prisma";
import type { Metadata } from "next";
import Link from "next/link";
import type React from "react";

const TITLE = "Reviews - What Auckland Clients Say";
const DESCRIPTION =
  "Real reviews from Auckland clients who have used To the Point Tech for computer repair, Wi-Fi setup, virus removal, smart home, and small-business IT support.";

export const metadata: Metadata = {
  // The layout template appends "| To the Point Tech", so the brand isn't repeated here.
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/reviews" },
  openGraph: pageOpenGraph({ title: TITLE, description: DESCRIPTION, url: "/reviews" }),
};

// Rely on on-demand revalidation (triggered by admin approve/delete/submit).
// Long fallback avoids waking a cold DB on a fixed timer.
export const revalidate = 86400;

/**
 * Reviews page component.
 * @returns Reviews page element.
 */
export default async function ReviewsPage(): Promise<React.ReactElement> {
  const [rows, identity] = await Promise.all([
    prisma.review.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        text: true,
        firstName: true,
        lastName: true,
        isAnonymous: true,
        createdAt: true,
      },
      where: { status: "approved" },
    }),
    getIdentity(),
  ]);

  const normalisedRows: PublicReview[] = rows.map((r) => ({
    ...r,
    text: r.text.trim().replace(/\s+/g, " "),
    firstName: r.firstName?.trim() || null,
    lastName: r.lastName?.trim() || null,
    // Dates can't cross the server > client boundary as Date objects.
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <PageShell>
      <ReviewScrollHandler />
      <PageHead
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Reviews", path: "/reviews" },
        ]}
        title="What clients say"
        intro={<p>Feedback from people I&apos;ve helped.</p>}
        action={
          <Button
            href={GOOGLE_BUSINESS_PROFILE_URL}
            target="_blank"
            rel="noopener noreferrer"
            variant="outline"
          >
            See my reviews on Google
          </Button>
        }
      />

      {rows.length === 0 ? (
        <Section aria-labelledby="no-reviews-heading">
          <SectionHeading title="No reviews yet" id="no-reviews-heading" />
          <p>
            Be the first!{" "}
            <Link href="/booking" className={TEXT_LINK}>
              Book an appointment
            </Link>{" "}
            and you&apos;ll get a review link after your visit.
          </p>
        </Section>
      ) : (
        // Grey band: the review cards are white, so they need a ground to stand out from.
        <Section tone="grey" aria-label="Client reviews">
          <ReviewsList reviews={normalisedRows} />
          <p className="mt-8 text-seasalt-700">
            Had an appointment? You&apos;ll receive a review link by email after your visit.
          </p>
        </Section>
      )}

      <ClosingCta
        title="Something not working?"
        line="Book online in a couple of minutes, or give me a call."
        phone={identity.phone}
        phoneTel={identity.phoneTel}
      />
    </PageShell>
  );
}
