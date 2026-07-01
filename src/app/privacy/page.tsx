// src/app/privacy/page.tsx
/**
 * @description Privacy policy: what we collect, how we use it, the analytics/ad
 * tools we run (Google, Meta Pixel incl. hashed advanced matching), and the
 * visitor's rights under the NZ Privacy Act 2020.
 */

import { BreadcrumbJsonLd } from "@/shared/components/BreadcrumbJsonLd";
import { CARD, FrostedSection, PageShell } from "@/shared/components/PageLayout";
import { cn } from "@/shared/lib/cn";
import type { Metadata } from "next";
import type React from "react";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How To The Point Tech collects, uses and protects your information, the analytics and advertising tools we use, and your rights under the NZ Privacy Act 2020.",
  alternates: { canonical: "/privacy" },
  openGraph: {
    title: "Privacy Policy - To The Point Tech",
    description: "What we collect, how we use it, and your privacy choices.",
    url: "/privacy",
  },
};

/** Plain hyphen, NZ English. Last reviewed date shown to visitors. */
const LAST_UPDATED = "2 July 2026";

const H2 = "mb-3 text-xl font-bold text-russian-violet sm:text-2xl";
const P = "text-base text-rich-black/90 sm:text-lg";
const LI = "flex gap-3 text-base text-rich-black/90 sm:text-lg";
const DOT = "mt-1 shrink-0 text-lg text-moonstone-600";
const LINK = "font-semibold text-russian-violet underline hover:text-coquelicot-500";

/**
 * Privacy policy page.
 * @returns React element for the privacy page.
 */
export default function PrivacyPage(): React.ReactElement {
  return (
    <PageShell>
      <BreadcrumbJsonLd
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Privacy", path: "/privacy" },
        ]}
      />
      <FrostedSection maxWidth="clamp(60rem, 70vw, 90rem)">
        <div className="flex flex-col gap-6 sm:gap-8">
          {/* Header */}
          <section className={cn(CARD, "animate-fade-in")}>
            <h1 className="mb-2 text-2xl font-extrabold text-russian-violet sm:text-3xl md:text-4xl">
              Privacy Policy
            </h1>
            <p className="mb-4 text-sm text-rich-black/60">Last updated: {LAST_UPDATED}</p>
            <p className={P}>
              To The Point Tech ("we", "us", "our") provides computer and IT support across
              Auckland. We respect your privacy and only collect what we need to help you. This
              policy explains what information we collect, how we use it, who we share it with, and
              the choices you have. If you have any questions, email{" "}
              <a href="mailto:harrison@tothepoint.co.nz" className={LINK}>
                harrison@tothepoint.co.nz
              </a>
              .
            </p>
          </section>

          {/* Content */}
          <section className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-100")}>
            <div className="flex flex-col gap-8">
              <div>
                <h2 className={H2}>Information we collect</h2>
                <p className={cn(P, "mb-3")}>
                  When you book an appointment or get in touch, we collect the details you give us:
                </p>
                <ul className="flex flex-col gap-2.5">
                  <li className={LI}>
                    <span className={DOT}>&bull;</span>
                    <span>Your name, email address and phone number</span>
                  </li>
                  <li className={LI}>
                    <span className={DOT}>&bull;</span>
                    <span>Your address, when a visit is on-site</span>
                  </li>
                  <li className={LI}>
                    <span className={DOT}>&bull;</span>
                    <span>Details about the device or problem you need help with</span>
                  </li>
                </ul>
                <p className={cn(P, "mt-3")}>
                  We also collect some information automatically when you use the site - such as the
                  pages you view, your device and browser type, and general location - using cookies
                  and similar technologies (see below).
                </p>
              </div>

              <div>
                <h2 className={H2}>How we use your information</h2>
                <ul className="flex flex-col gap-2.5">
                  <li className={LI}>
                    <span className={DOT}>&bull;</span>
                    <span>To arrange, provide and follow up on your tech support</span>
                  </li>
                  <li className={LI}>
                    <span className={DOT}>&bull;</span>
                    <span>To send booking confirmations, calendar invites and reminders</span>
                  </li>
                  <li className={LI}>
                    <span className={DOT}>&bull;</span>
                    <span>To reply to your enquiries and, after a job, invite a review</span>
                  </li>
                  <li className={LI}>
                    <span className={DOT}>&bull;</span>
                    <span>To improve the website and measure how well our advertising works</span>
                  </li>
                </ul>
              </div>

              <div>
                <h2 className={H2}>Cookies, analytics and advertising</h2>
                <p className={cn(P, "mb-3")}>
                  We use cookies and small tracking scripts ("pixels") to understand how the site is
                  used and to measure our advertising. These include:
                </p>
                <ul className="flex flex-col gap-2.5">
                  <li className={LI}>
                    <span className={DOT}>&bull;</span>
                    <span>
                      <strong>Google Analytics</strong> - to see how visitors use the site.
                    </span>
                  </li>
                  <li className={LI}>
                    <span className={DOT}>&bull;</span>
                    <span>
                      <strong>Google Ads</strong> and the{" "}
                      <strong>Meta (Facebook/Instagram) Pixel</strong> - to measure ad performance
                      and show relevant ads.
                    </span>
                  </li>
                  <li className={LI}>
                    <span className={DOT}>&bull;</span>
                    <span>
                      <strong>Meta advanced matching:</strong> when you submit your booking or
                      contact details, a scrambled (hashed, one-way) version of information like
                      your email or phone number may be shared with Meta to match up ad results.
                      This is not shared as readable text and can't be reversed by us.
                    </span>
                  </li>
                  <li className={LI}>
                    <span className={DOT}>&bull;</span>
                    <span>
                      <strong>Vercel Analytics</strong> - privacy-friendly performance statistics.
                    </span>
                  </li>
                </ul>
                <p className={cn(P, "mt-3")}>
                  You can control or block cookies in your browser settings, use a tracker/ad
                  blocker, or adjust your ad preferences at{" "}
                  <a
                    href="https://adssettings.google.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={LINK}
                  >
                    Google Ad Settings
                  </a>{" "}
                  and{" "}
                  <a
                    href="https://www.facebook.com/adpreferences"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={LINK}
                  >
                    Meta Ad Preferences
                  </a>
                  .
                </p>
              </div>

              <div>
                <h2 className={H2}>Who we share it with</h2>
                <p className={cn(P, "mb-3")}>
                  We do not sell your personal information. We share it only with the service
                  providers that help us run the business:
                </p>
                <ul className="flex flex-col gap-2.5">
                  <li className={LI}>
                    <span className={DOT}>&bull;</span>
                    <span>Google (Analytics, Ads, Maps and Calendar)</span>
                  </li>
                  <li className={LI}>
                    <span className={DOT}>&bull;</span>
                    <span>Meta Platforms (advertising pixel)</span>
                  </li>
                  <li className={LI}>
                    <span className={DOT}>&bull;</span>
                    <span>Our email provider, for booking and review emails</span>
                  </li>
                  <li className={LI}>
                    <span className={DOT}>&bull;</span>
                    <span>Our website hosting and database providers</span>
                  </li>
                </ul>
                <p className={cn(P, "mt-3")}>
                  Some of these providers are based overseas, so your information may be stored or
                  processed outside New Zealand. They handle it on our behalf under their own
                  privacy and security terms.
                </p>
              </div>

              <div>
                <h2 className={H2}>How long we keep it</h2>
                <p className={P}>
                  We keep booking and contact records only as long as we need them - to provide the
                  service, for our own records, and to meet legal and tax obligations - after which
                  we delete them.
                </p>
              </div>

              <div>
                <h2 className={H2}>Your rights</h2>
                <p className={P}>
                  Under the New Zealand Privacy Act 2020 you can ask to see the personal information
                  we hold about you and request corrections. Email{" "}
                  <a href="mailto:harrison@tothepoint.co.nz" className={LINK}>
                    harrison@tothepoint.co.nz
                  </a>{" "}
                  and we'll help. If you're not satisfied, you can contact the{" "}
                  <a
                    href="https://www.privacy.org.nz"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={LINK}
                  >
                    Office of the Privacy Commissioner
                  </a>
                  .
                </p>
              </div>

              <div>
                <h2 className={H2}>Security</h2>
                <p className={P}>
                  We take reasonable steps to protect your information, but no method of storage or
                  transmission over the internet is completely secure.
                </p>
              </div>

              <div>
                <h2 className={H2}>Changes to this policy</h2>
                <p className={P}>
                  We may update this policy from time to time. The "last updated" date at the top
                  shows when it last changed.
                </p>
              </div>

              <div>
                <h2 className={H2}>Contact us</h2>
                <p className={P}>
                  Questions about your privacy? Email{" "}
                  <a href="mailto:harrison@tothepoint.co.nz" className={LINK}>
                    harrison@tothepoint.co.nz
                  </a>{" "}
                  or call{" "}
                  <a href="tel:+64212971237" className={LINK}>
                    021 297 1237
                  </a>
                  .
                </p>
              </div>
            </div>
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
