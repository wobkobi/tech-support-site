"use client";
// src/shared/components/MobileActionBar.tsx
// Phone-only Call + Book bar pinned to the bottom. Call is a plain tel: anchor, so GoogleTag
// records it as a conversion with no wiring here.

import { isPrintRoute } from "@/shared/lib/print-routes";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type React from "react";
import { FaCalendarCheck, FaPhone } from "react-icons/fa6";

/** Paths that hide the bar: admin, booking (where Book leads) and the review form. */
const HIDDEN_PREFIXES: ReadonlyArray<string> = ["/admin", "/booking", "/review"];

/**
 * Whether the bar stays off this path.
 * @param pathname - Current pathname.
 * @returns True when the bar should not render.
 */
function isHiddenOn(pathname: string): boolean {
  if (isPrintRoute(pathname)) return true;
  return HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Phone-only Call and Book bar, plus an in-flow spacer so the footer scrolls clear. Hides
 * while the nav drawer is open (`data-nav-open` on body) or a field has focus.
 * @param props - Component props.
 * @param props.phoneTel - tel: URI for the business phone.
 * @returns The bar and its spacer, or null on hidden paths.
 */
export function MobileActionBar({ phoneTel }: { phoneTel: string }): React.ReactElement | null {
  const pathname = usePathname();
  if (isHiddenOn(pathname)) return null;

  return (
    <>
      <div aria-hidden="true" className="h-[calc(3.75rem+env(safe-area-inset-bottom))] sm:hidden" />
      <nav
        aria-label="Call or book"
        className="mobile-action-bar fixed inset-x-0 bottom-0 z-30 grid grid-cols-2 border-t border-seasalt-100 bg-white sm:hidden print:hidden"
      >
        <a
          href={phoneTel}
          className="flex items-center justify-center gap-2 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-lg font-extrabold text-russian-violet"
        >
          <FaPhone className="h-4 w-4" aria-hidden />
          Call
        </a>
        <Link
          href="/booking"
          className="flex items-center justify-center gap-2 bg-coquelicot-600 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-lg font-extrabold text-white"
        >
          <FaCalendarCheck className="h-5 w-5" aria-hidden />
          Book now
        </Link>
      </nav>
    </>
  );
}
