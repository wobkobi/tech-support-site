// src/app/privacy/page.tsx
// Privacy policy: what the site collects, how it is used, the analytics/ad tools it runs
// (Google, Meta Pixel incl. hashed advanced matching), sharing, retention, and visitors'
// rights under the NZ Privacy Act 2020.

import { PageHead } from "@/shared/components/PageHead";
import { PageShell } from "@/shared/components/PageLayout";
import { Section, TEXT_LINK } from "@/shared/components/Section";
import { TickItem, TickList } from "@/shared/components/TickList";
import { getIdentity } from "@/shared/lib/business-identity.server";
import type { Metadata } from "next";
import type React from "react";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How To the Point Tech collects, uses and protects your information, the analytics and advertising tools I use, and your rights under the NZ Privacy Act 2020.",
  alternates: { canonical: "/privacy" },
  openGraph: {
    title: "Privacy Policy - To the Point Tech",
    description: "What I collect, how I use it, and your privacy choices.",
    url: "/privacy",
  },
};

/** Date this policy was last reviewed; shown to visitors in the header. */
const LAST_UPDATED = "12 October 2026";

const H2 = "mb-4 text-[1.75rem] font-extrabold";

/**
 * Privacy policy page.
 * @returns React element for the privacy page.
 */
export default async function PrivacyPage(): Promise<React.ReactElement> {
  const identity = await getIdentity();
  return (
    <PageShell>
      <PageHead
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Privacy", path: "/privacy" },
        ]}
        title="Privacy Policy"
        intro={
          <p>
            To the Point Tech (&quot;I&quot;, &quot;me&quot;, &quot;my&quot;) provides computer and
            IT support across Auckland. I respect your privacy and only collect what I need to help
            you. This policy explains what information I collect, how I use it, who I share it with,
            and the choices you have. If you have any questions, email{" "}
            <a href={`mailto:${identity.email}`} className={TEXT_LINK}>
              {identity.email}
            </a>
            .
          </p>
        }
        note={<p>Last updated: {LAST_UPDATED}</p>}
        action={null}
      />

      <Section aria-label="Privacy policy">
        <div className="flex max-w-180 flex-col gap-10">
          <div>
            <h2 className={H2}>Information I collect</h2>
            <p className="mb-3">
              When you book an appointment or get in touch, I collect the details you give me:
            </p>
            <TickList>
              <TickItem variant="dot">Your name, email address and phone number</TickItem>
              <TickItem variant="dot">Your address, when a visit is on-site</TickItem>
              <TickItem variant="dot">
                Details about the device or problem you need help with
              </TickItem>
            </TickList>
            <p className="mt-3">
              I also collect some information automatically when you use the site - such as the
              pages you view, your device and browser type, and general location - using cookies and
              similar technologies (see below).
            </p>
          </div>

          <div>
            <h2 className={H2}>How I use your information</h2>
            <TickList>
              <TickItem variant="dot">
                To arrange, provide and follow up on your tech support
              </TickItem>
              <TickItem variant="dot">
                To send booking confirmations, calendar invites and reminders
              </TickItem>
              <TickItem variant="dot">
                To reply to your enquiries and, after a job, invite a review
              </TickItem>
              <TickItem variant="dot">
                To send you the occasional email about offers, holiday hours or scam warnings. Every
                one has an unsubscribe link, and unsubscribing doesn&apos;t stop emails about your
                own bookings and invoices.
              </TickItem>
              <TickItem variant="dot">
                To improve the website and measure how well my advertising works
              </TickItem>
            </TickList>
          </div>

          <div>
            <h2 className={H2}>Cookies, analytics and advertising</h2>
            <p className="mb-3">
              I use cookies and small tracking scripts (&quot;pixels&quot;) to understand how the
              site is used and to measure my advertising. These include:
            </p>
            <TickList>
              <TickItem variant="dot">
                <strong>Google Analytics</strong> - to see how visitors use the site.
              </TickItem>
              <TickItem variant="dot">
                <strong>Google Ads</strong> and the <strong>Meta (Facebook/Instagram) Pixel</strong>{" "}
                - to measure ad performance and show relevant ads.
              </TickItem>
              <TickItem variant="dot">
                <strong>Meta advanced matching:</strong> when you submit your booking or contact
                details, a scrambled (hashed, one-way) version of information like your email or
                phone number may be shared with Meta to match up ad results. This is not shared as
                readable text and can&apos;t be reversed by me.
              </TickItem>
              <TickItem variant="dot">
                <strong>Vercel Analytics</strong> - privacy-friendly performance statistics.
              </TickItem>
            </TickList>
            <p className="mt-3">
              You can control or block cookies in your browser settings, use a tracker/ad blocker,
              or adjust your ad preferences at{" "}
              <a
                href="https://adssettings.google.com"
                target="_blank"
                rel="noopener noreferrer"
                className={TEXT_LINK}
              >
                Google Ad Settings
              </a>{" "}
              and{" "}
              <a
                href="https://www.facebook.com/adpreferences"
                target="_blank"
                rel="noopener noreferrer"
                className={TEXT_LINK}
              >
                Meta Ad Preferences
              </a>
              .
            </p>
          </div>

          <div>
            <h2 className={H2}>Who I share it with</h2>
            <p className="mb-3">
              I do not sell your personal information. I share it only with the service providers
              that help me run the business:
            </p>
            <TickList>
              <TickItem variant="dot">Google (Analytics, Ads, Maps and Calendar)</TickItem>
              <TickItem variant="dot">Meta Platforms (advertising pixel)</TickItem>
              <TickItem variant="dot">
                My email provider, for booking, review and mailing-list emails
              </TickItem>
              <TickItem variant="dot">My website hosting and database providers</TickItem>
            </TickList>
            <p className="mt-3">
              Some of these providers are based overseas, so your information may be stored or
              processed outside New Zealand. They handle it on my behalf under their own privacy and
              security terms.
            </p>
          </div>

          <div>
            <h2 className={H2}>How long I keep it</h2>
            <p>
              I keep booking and contact records only as long as I need them - to provide the
              service, for my own records, and to meet legal and tax obligations - after which I
              delete them.
            </p>
          </div>

          <div>
            <h2 className={H2}>Your rights</h2>
            <p>
              Under the New Zealand Privacy Act 2020 you can ask to see the personal information I
              hold about you and request corrections. Email{" "}
              <a href={`mailto:${identity.email}`} className={TEXT_LINK}>
                {identity.email}
              </a>{" "}
              and I&apos;ll help. If you&apos;re not satisfied, you can contact the{" "}
              <a
                href="https://www.privacy.org.nz"
                target="_blank"
                rel="noopener noreferrer"
                className={TEXT_LINK}
              >
                Office of the Privacy Commissioner
              </a>
              .
            </p>
          </div>

          <div>
            <h2 className={H2}>Security</h2>
            <p>
              I take reasonable steps to protect your information, but no method of storage or
              transmission over the internet is completely secure.
            </p>
          </div>

          <div>
            <h2 className={H2}>Changes to this policy</h2>
            <p>
              I may update this policy from time to time. The &quot;last updated&quot; date at the
              top shows when it last changed.
            </p>
          </div>

          <div>
            <h2 className={H2}>Contact me</h2>
            <p>
              Questions about your privacy? Email{" "}
              <a href={`mailto:${identity.email}`} className={TEXT_LINK}>
                {identity.email}
              </a>{" "}
              or call{" "}
              <a href={identity.phoneTel} className={TEXT_LINK}>
                {identity.phone}
              </a>
              .
            </p>
          </div>
        </div>
      </Section>
    </PageShell>
  );
}
