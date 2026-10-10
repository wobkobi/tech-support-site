"use client";
// src/shared/components/SiteFooter.tsx
// Dark site footer: brand line, Services and Company links, contact details and social
// profiles. Hidden on admin and print routes, matching the header. A direct child of
// <body>, so it is the page's single contentinfo landmark.

import { CONTAINER } from "@/shared/components/Section";
import {
  FACEBOOK_PAGE_URL,
  GOOGLE_BUSINESS_PROFILE_URL,
  INSTAGRAM_URL,
} from "@/shared/lib/business-profiles";
import { cn } from "@/shared/lib/cn";
import { isPrintRoute } from "@/shared/lib/print-routes";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type React from "react";

/** Path prefixes that hide the footer (admin has its own chrome). */
const HIDDEN_PREFIXES: ReadonlyArray<string> = ["/admin"];

const SERVICE_LINKS: ReadonlyArray<{ label: string; href: string }> = [
  { label: "Computers & laptops", href: "/services#computers-laptops" },
  { label: "Wi-Fi & internet", href: "/services#wifi-internet" },
  { label: "Phones & tablets", href: "/services#phones-tablets" },
  { label: "Business IT support", href: "/business" },
  { label: "All services", href: "/services" },
];

const COMPANY_LINKS: ReadonlyArray<{ label: string; href: string }> = [
  { label: "About", href: "/about" },
  { label: "Pricing", href: "/pricing" },
  { label: "Reviews", href: "/reviews" },
  { label: "FAQ", href: "/faq" },
  { label: "Privacy", href: "/privacy" },
];

/** Off-site profiles; the same URLs feed the LocalBusiness JSON-LD sameAs. */
const PROFILES: ReadonlyArray<{ label: string; href: string }> = [
  { label: "Facebook", href: FACEBOOK_PAGE_URL },
  { label: "Instagram", href: INSTAGRAM_URL },
  { label: "Google", href: GOOGLE_BUSINESS_PROFILE_URL },
];

// Touch screens get 44px rows, so the stacked links are easy to hit with a finger.
const LINK =
  "hover:text-white hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center";

/** Props for {@link SiteFooter}. */
export interface SiteFooterProps {
  /** Display phone number from identity settings. */
  phone: string;
  /** tel: URI from identity settings. */
  phoneTel: string;
  /** Business email from identity settings. */
  email: string;
}

/**
 * Footer shown at the bottom of every public page.
 * @param props - Component props.
 * @param props.phone - Display phone number.
 * @param props.phoneTel - tel: URI.
 * @param props.email - Business email.
 * @returns The footer element, or null on hidden paths.
 */
export function SiteFooter({ phone, phoneTel, email }: SiteFooterProps): React.ReactElement | null {
  const pathname = usePathname();
  if (isPrintRoute(pathname)) return null;
  if (HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;

  const year = new Date().getFullYear();

  return (
    <footer className="bg-rich-black pt-13 pb-6 text-base text-seasalt-200 print:hidden">
      <div className={CONTAINER}>
        <div className="grid gap-9 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
          <div>
            <Image
              src="/source/logo-wordmark.svg"
              alt="To the Point Tech"
              width={2000}
              height={674}
              className="mb-3.5 h-14 w-auto brightness-0 invert"
            />
            <p>Friendly computer &amp; IT support across Auckland, at your home or business.</p>
          </div>
          <nav aria-labelledby="footer-services">
            <h2 id="footer-services" className="mb-3 text-base font-bold text-white">
              Services
            </h2>
            <ul className="grid gap-2 pointer-coarse:gap-0">
              {SERVICE_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className={LINK}>
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-labelledby="footer-company">
            <h2 id="footer-company" className="mb-3 text-base font-bold text-white">
              Company
            </h2>
            <ul className="grid gap-2 pointer-coarse:gap-0">
              {COMPANY_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className={LINK}>
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div>
            <h2 className="mb-3 text-base font-bold text-white">Get in touch</h2>
            <ul className="grid gap-2 pointer-coarse:gap-0">
              <li>
                <a href={phoneTel} className={cn(LINK, "font-bold text-white")}>
                  {phone}
                </a>
              </li>
              <li>
                <a href={`mailto:${email}`} className={cn(LINK, "break-all")}>
                  {email}
                </a>
              </li>
              <li>
                <Link href="/booking" className={LINK}>
                  Book online
                </Link>
              </li>
              <li className="flex flex-wrap gap-x-2 pointer-coarse:gap-x-3">
                {PROFILES.map((p, i) => (
                  <span key={p.href} className="flex gap-x-2">
                    {i > 0 && <span aria-hidden="true">&middot;</span>}
                    <a href={p.href} target="_blank" rel="noopener noreferrer" className={LINK}>
                      {p.label}
                    </a>
                  </span>
                ))}
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-10 flex flex-wrap justify-between gap-3 border-t border-seasalt-800 pt-5 text-sm">
          <span>&copy; {year} To the Point Tech</span>
          <span>Serving all of Auckland</span>
        </div>
      </div>
    </footer>
  );
}
