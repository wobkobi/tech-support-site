// src/app/about/page.tsx
// About page: background, approach, and who the service helps.

import { ClosingCta } from "@/shared/components/ClosingCta";
import { PageHead } from "@/shared/components/PageHead";
import { PageShell } from "@/shared/components/PageLayout";
import { Section, SectionHeading, TEXT_LINK } from "@/shared/components/Section";
import { TickItem, TickList } from "@/shared/components/TickList";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { getSiteUrl } from "@/shared/lib/site-url";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import type React from "react";

const siteUrl = getSiteUrl();

/** Portrait, relative to the public directory. */
const PHOTO_SRC = "/source/harrison-2026.jpg";

export const metadata: Metadata = {
  title: "Harrison Raynes - Auckland Tech Support",
  description:
    "Computer science graduate based in Auckland. I help households and small businesses across Auckland with friendly, jargon-free tech support.",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "About - To the Point Tech",
    description: "Local computer and IT support across Auckland.",
    url: "/about",
    type: "profile",
  },
};

/**
 * About page component.
 * @returns About page element.
 */
export default async function AboutPage(): Promise<React.ReactElement> {
  const identity = await getIdentity();

  // Tie the person entity to the business `@id` so a "Harrison Raynes"
  // search resolves to the business and vice versa.
  const personJsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": `${siteUrl}/about#person`,
    name: "Harrison Raynes",
    jobTitle: "Owner and Technician",
    worksFor: { "@id": `${siteUrl}#business` },
    knowsAbout: ["Computer Repair", "IT Support", "Networking", "Smart Home Setup"],
    workLocation: { "@type": "City", name: "Auckland" },
    url: `${siteUrl}/about`,
    image: `${siteUrl}${PHOTO_SRC}`,
    // Personal profiles only; business profiles go on the LocalBusiness sameAs.
    sameAs: [
      "https://www.linkedin.com/in/harrisonraynes/",
      "https://www.facebook.com/harrisonraynes/",
    ],
  };

  return (
    <PageShell>
      <script
        id="ld-person"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd) }}
      />
      <PageHead
        crumbs={[
          { name: "Home", path: "/" },
          { name: "About", path: "/about" },
        ]}
        title="About Harrison Raynes"
        intro="I'm Harrison Raynes, a computer science graduate based in Auckland. I started To the Point Tech because plenty of people have a computer problem and no one straightforward to call about it."
        note="I come to you and fix it on the spot where I can. You'll know what went wrong and what I changed, in words that actually mean something, so next time it happens you might not need to call me at all."
        action={null}
      />

      {/* Portrait and role */}
      <Section containerClassName="grid items-center gap-8 md:grid-cols-[18rem_1fr] md:gap-12">
        <Image
          src={PHOTO_SRC}
          alt="Harrison Raynes"
          width={400}
          height={400}
          preload
          className="w-full max-w-[18rem] rounded-lg object-cover"
        />
        <div>
          <p className="text-sm font-bold tracking-[0.06em] text-moonstone-700 uppercase">
            Owner and Technician
          </p>
          <p className="mt-2 text-xl font-extrabold">Harrison Raynes</p>
          <p className="mt-3 text-seasalt-700">
            Computer science graduate, Auckland born and raised.
          </p>
        </div>
      </Section>

      <Section tone="grey" aria-labelledby="about-approach-heading">
        <SectionHeading id="about-approach-heading" title="My approach" />
        <TickList className="mb-4">
          <TickItem>
            <strong>Listen first.</strong> I start with a quick chat to understand what's happening
            and what you want to achieve.
          </TickItem>
          <TickItem>
            <strong>Explain before acting.</strong> You'll know what I'm planning to do and roughly
            how long it should take before I touch anything.
          </TickItem>
          <TickItem>
            <strong>Work transparently.</strong> I make changes in small steps so you can see what's
            happening and ask questions.
          </TickItem>
          <TickItem>
            <strong>Leave clear notes.</strong> After every visit, you get a simple summary of what
            changed and any tips for next time.
          </TickItem>
        </TickList>
        <p className="text-seasalt-700">
          I'm happy to work with you directly, alongside family members, or with a small business
          owner. If you prefer, we can start with email and move to a visit once you're comfortable.
        </p>
      </Section>

      <Section aria-labelledby="about-who-heading">
        <SectionHeading id="about-who-heading" title="Who I help" />
        <p className="mb-4">
          I mainly work with households and small businesses across Auckland who want their tech to
          just work, without wading through jargon or sales pitches.
        </p>
        <TickList className="mb-4">
          <TickItem variant="dot">
            Home users wanting reliable Wi-Fi, secure accounts, and proper backups.
          </TickItem>
          <TickItem variant="dot">
            Families helping parents or grandparents get comfortable with devices.
          </TickItem>
          <TickItem variant="dot">
            Sole traders and small teams who need occasional IT help, or ongoing cover with a simple
            monthly retainer.
          </TickItem>
        </TickList>
        <p className="text-seasalt-700">
          See the{" "}
          <Link href="/services" className={TEXT_LINK}>
            services page
          </Link>{" "}
          for specifics, or{" "}
          <Link href="/contact" className={TEXT_LINK}>
            get in touch
          </Link>{" "}
          to chat about what you need.
        </p>
      </Section>

      <ClosingCta
        title="Something not working?"
        line="Book online in a couple of minutes, or give me a call."
        phone={identity.phone}
        phoneTel={identity.phoneTel}
      />
    </PageShell>
  );
}
