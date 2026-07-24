"use client";
// src/shared/components/SiteFooter.tsx
/**
 * @description Site-wide footer with quick links, the privacy policy link, and
 * copyright. Hidden on the admin area and the print-only poster, matching the
 * NavBar's hidden paths. A direct child of <body>, so it is the page's single
 * contentinfo landmark (the homepage's contact bar lives inside <main>).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type React from "react";

/** Exact paths that hide the footer (print-only poster). */
const HIDDEN_PATHS: ReadonlyArray<string> = ["/poster"];
/** Path prefixes that hide the footer (admin has its own chrome). */
const HIDDEN_PREFIXES: ReadonlyArray<string> = ["/admin"];

const LINKS: ReadonlyArray<{ label: string; href: string }> = [
  { label: "Services", href: "/services" },
  { label: "Business", href: "/business" },
  { label: "Pricing", href: "/pricing" },
  { label: "About", href: "/about" },
  { label: "FAQ", href: "/faq" },
  { label: "Reviews", href: "/reviews" },
  { label: "Contact", href: "/contact" },
  { label: "Book", href: "/booking" },
  { label: "Privacy", href: "/privacy" },
];

/**
 * Footer shown at the bottom of every public page.
 * @returns The footer element, or null on hidden paths.
 */
export function SiteFooter(): React.ReactElement | null {
  const pathname = usePathname();
  if (HIDDEN_PATHS.includes(pathname)) return null;
  if (HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;

  const year = new Date().getFullYear();

  return (
    <footer className="mx-auto mt-8 mb-6 w-full max-w-[min(100vw-2rem,clamp(90rem,75vw,140rem))] px-4">
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-seasalt-200/40 bg-white/70 p-6 shadow-lg backdrop-blur-md sm:p-8">
        <nav
          aria-label="Footer"
          className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2"
        >
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-base font-semibold text-rich-black transition-colors hover:text-coquelicot-500"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <p className="text-center text-sm text-rich-black/70 sm:text-base">
          {`© ${year} To the Point Tech - friendly computer & IT support across Auckland.`}
        </p>
      </div>
    </footer>
  );
}
