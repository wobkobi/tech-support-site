// src/app/contact/page.tsx
// Contact page: how to get in touch.

import { ClosingCta } from "@/shared/components/ClosingCta";
import { PageHead } from "@/shared/components/PageHead";
import { PageShell } from "@/shared/components/PageLayout";
import { RuledBlock, RuledGrid } from "@/shared/components/RuledGrid";
import { Section, SectionHeading, TEXT_LINK } from "@/shared/components/Section";
import { TickItem, TickList } from "@/shared/components/TickList";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { pageOpenGraph } from "@/shared/lib/open-graph";
import type { Metadata } from "next";
import Link from "next/link";
import type React from "react";

/**
 * Contact page metadata, with the live phone and email from the identity settings.
 * @returns Page metadata.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { phone, email } = await getIdentity();
  const title = "Contact - Local Tech Support in Auckland";
  const description = `Call ${phone} or email ${email} for friendly tech support across Auckland. Same-day and weekend appointments available.`;
  return {
    title,
    description,
    alternates: { canonical: "/contact" },
    openGraph: pageOpenGraph({ title, description, url: "/contact" }),
  };
}

/** Details that help with a quick, accurate quote. */
const WHAT_TO_INCLUDE: ReadonlyArray<string> = [
  "What's happening or what you want to achieve",
  "Which devices are involved (e.g., laptop, phone, printer)",
  "Whether it's for home or business",
  "Your availability (mornings, evenings, weekends)",
];

/**
 * Contact page component.
 * @returns React element for the contact page.
 */
export default async function ContactPage(): Promise<React.ReactElement> {
  const identity = await getIdentity();
  return (
    <PageShell>
      <PageHead
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Contact", path: "/contact" },
        ]}
        title="Get in touch"
        intro={
          <p>
            Have a tech problem or question? Call or email and I&apos;ll help you figure it out.
          </p>
        }
        note={<p>I usually respond within a few hours during business days.</p>}
        action={null}
      />

      <Section aria-label="Ways to reach me">
        <RuledGrid cols={2}>
          <RuledBlock title="Call or text" as="h2">
            <a
              href={identity.phoneTel}
              className="block py-2 text-2xl font-extrabold text-russian-violet hover:text-coquelicot-700"
            >
              {identity.phone}
            </a>
            <p className="text-seasalt-700">The quickest way to reach me.</p>
          </RuledBlock>
          <RuledBlock title="Email" as="h2">
            <a
              href={`mailto:${identity.email}`}
              className="block py-2 text-xl font-extrabold break-all text-russian-violet hover:text-coquelicot-700 sm:text-2xl"
            >
              {identity.email}
            </a>
            <p className="text-seasalt-700">
              Good for photos of an error message or a longer question.
            </p>
          </RuledBlock>
        </RuledGrid>
      </Section>

      <Section tone="grey" aria-labelledby="area-heading">
        <SectionHeading title="Service area" id="area-heading" />
        <p>
          On-site visits across Auckland.{" "}
          <Link href="/areas" className={TEXT_LINK}>
            See the areas I cover and what travel costs
          </Link>
          .
        </p>
        <p className="mt-3">
          A lot of software and account problems I can sort out remotely, so there&apos;s no travel
          to pay for.
        </p>
      </Section>

      <Section aria-labelledby="details-heading">
        <SectionHeading
          title="What to include when you contact me"
          id="details-heading"
          lead="A few details help me give you a quick, accurate quote:"
        />
        <TickList>
          {WHAT_TO_INCLUDE.map((line) => (
            <TickItem key={line}>{line}</TickItem>
          ))}
        </TickList>
        <p className="mt-6">
          Feel free to include screenshots or photos if they help explain the issue.
        </p>
      </Section>

      <ClosingCta
        title="Prefer to book directly?"
        line="Pick a time online in a couple of minutes."
        phone={identity.phone}
        phoneTel={identity.phoneTel}
      />
    </PageShell>
  );
}
