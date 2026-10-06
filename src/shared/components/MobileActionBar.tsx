"use client";
// src/shared/components/MobileActionBar.tsx
// Call + Book bar pinned to the bottom of the screen on phones. Long pages otherwise
// offer those two actions only at the very top and the very bottom, several screens
// apart. The Call button is a plain tel: anchor, so GoogleTag's delegated tel: listener
// records it as a phone-call conversion with no wiring here.

import { Button } from "@/shared/components/Button";
import { isPrintRoute } from "@/shared/lib/print-routes";
import { usePathname } from "next/navigation";
import type React from "react";
import { FaCalendarCheck, FaPhone } from "react-icons/fa6";

/**
 * Path prefixes that hide the bar: admin has its own chrome, the booking pages
 * are where Book leads, and the review form needs the screen to itself.
 */
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
 * Sticky phone-only action bar with Call and Book buttons.
 *
 * Also renders an in-flow spacer the height of the bar, so the end of the page
 * (the footer links) can always scroll clear of it. The bar hides while the nav
 * drawer is open (NavBar flags `data-nav-open` on body) and while a form field
 * has focus, where it would otherwise ride up on the keyboard over the field.
 * @param props - Component props.
 * @param props.phoneTel - tel: URI for the business phone.
 * @returns The bar and its spacer, or null on hidden paths.
 */
export function MobileActionBar({ phoneTel }: { phoneTel: string }): React.ReactElement | null {
  const pathname = usePathname();
  if (isHiddenOn(pathname)) return null;

  return (
    <>
      <div aria-hidden="true" className="h-[calc(4.5rem+env(safe-area-inset-bottom))] sm:hidden" />
      <nav
        aria-label="Call or book"
        className="mobile-action-bar fixed inset-x-0 bottom-0 z-30 border-t border-seasalt-200/60 bg-white/95 px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgb(0_0_0/0.08)] backdrop-blur-md sm:hidden print:hidden"
      >
        <div className="grid grid-cols-2 gap-3">
          <Button href={phoneTel} variant="secondary" size="md" fullWidth>
            <FaPhone className="h-4 w-4" aria-hidden />
            Call
          </Button>
          <Button href="/booking" variant="primary" size="md" fullWidth>
            <FaCalendarCheck className="h-5 w-5" aria-hidden />
            Book now
          </Button>
        </div>
      </nav>
    </>
  );
}
