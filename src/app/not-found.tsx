// src/app/not-found.tsx
// 404 page. Uses the inner pages' grey head band and ruled sections, with its own head:
// an "Error 404" label, the requested address and a large decorative 404.

import { Button } from "@/shared/components/Button";
import { PageShell } from "@/shared/components/PageLayout";
import { RuledBlock, RuledGrid } from "@/shared/components/RuledGrid";
import { CONTAINER, Section, SectionHeading, TEXT_LINK } from "@/shared/components/Section";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { cn } from "@/shared/lib/cn";
import type { Metadata } from "next";
import Link from "next/link";
import type React from "react";
import { RequestedPath } from "./RequestedPath";

// Without this the tab shows the home page title. Next adds noindex itself.
export const metadata: Metadata = { title: "Page not found" };

/** Main pages offered as a way back in. */
const NEXT_STEPS: ReadonlyArray<{ href: string; label: string; blurb: string }> = [
  { href: "/services", label: "Services", blurb: "What I can help with." },
  { href: "/pricing", label: "Pricing", blurb: "My rates and what's included." },
  { href: "/booking", label: "Book a visit", blurb: "Pick a time that suits you." },
  { href: "/contact", label: "Contact", blurb: "Call, text or email me." },
];

/**
 * 404 UI for missing routes.
 * @returns Not Found page element.
 */
export default async function NotFound(): Promise<React.ReactElement> {
  const identity = await getIdentity();

  return (
    <PageShell>
      {/* Same band as PageHead, minus the breadcrumb: a missing page has no place in the trail. */}
      <header className="border-b border-seasalt-100 bg-seasalt py-9 sm:pt-10 sm:pb-11">
        <div className={cn(CONTAINER, "flex items-end justify-between gap-8")}>
          <div className="max-w-180">
            <p className="mb-2.5 text-sm font-bold tracking-[0.06em] text-moonstone-700 uppercase">
              Error 404
            </p>
            <h1 className="text-[1.875rem] leading-tight font-extrabold text-balance text-rich-black sm:text-[2.5rem]">
              Page not found
            </h1>
            <p className="mt-3 text-lg sm:text-[1.1875rem]">
              There&apos;s no page at <RequestedPath />. It may have moved, or the link may have a
              typo.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button href="/" variant="primary">
                Back to home
              </Button>
              <Button href="/contact" variant="ghost">
                Contact me
              </Button>
            </div>
          </div>
          <span
            aria-hidden="true"
            className="hidden text-[9rem] leading-[0.8] font-extrabold text-seasalt-200 select-none md:block lg:text-[11rem]"
          >
            404
          </span>
        </div>
      </header>

      <Section aria-labelledby="next-heading">
        <SectionHeading title="Where to next" id="next-heading" />
        <RuledGrid cols={4}>
          {NEXT_STEPS.map((s) => (
            <RuledBlock
              key={s.href}
              title={
                <Link href={s.href} className={cn(TEXT_LINK, "inline-flex min-h-11 items-center")}>
                  {s.label}
                </Link>
              }
            >
              <p className="text-seasalt-700">{s.blurb}</p>
            </RuledBlock>
          ))}
        </RuledGrid>
        <p className="mt-10">
          Looking for something specific? Call or text me on{" "}
          <a href={identity.phoneTel} className={TEXT_LINK}>
            {identity.phone}
          </a>
          .
        </p>
      </Section>
    </PageShell>
  );
}
