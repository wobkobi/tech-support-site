"use client";
// src/shared/components/PromoBannerClient.tsx
// Banner with 24h dismissal. Renders on first paint and sits in normal flow above the sticky header.

import { summariseForBanner, type ActivePromo } from "@/features/business/lib/promos";
import { cn } from "@/shared/lib/cn";
import { isPrintRoute } from "@/shared/lib/print-routes";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type React from "react";
import { useEffect, useState } from "react";
import { FaBolt, FaXmark } from "react-icons/fa6";

const PROMO_DISMISSED_KEY = "promo-banner-dismissed-at";
/** How long a dismissal sticks before the banner returns. */
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000;

interface Props {
  promo: ActivePromo;
}

/**
 * Site-wide promo banner with 24h dismissal.
 * @param props - Component props.
 * @param props.promo - Active promo from the server wrapper.
 * @returns Banner element.
 */
export function PromoBannerClient({ promo }: Props): React.ReactElement {
  const pathname = usePathname();
  // Print artwork carries no chrome at all - a banner here would be printed
  // onto the poster or business card.
  // Admin pages have their own chrome - no public promo banner over the top.
  // Business too, not just admin: promos are a home-rate offer, and the phrase
  // is unscoped ("15% off"), so on the business page it would promise a
  // discount the invoice does not honour.
  const hidden =
    isPrintRoute(pathname) ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/business" ||
    pathname.startsWith("/business/");

  // Shown by default so the server HTML includes the banner and the page never
  // shifts down after hydration; the effect hides it when a dismissal is still fresh.
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      const dismissedAt = Number(window.localStorage.getItem(PROMO_DISMISSED_KEY) ?? 0);
      if (dismissedAt && Date.now() - dismissedAt < DISMISS_TTL_MS) {
        // queueMicrotask defers the setState past the effect body, satisfying
        // the React lint while still firing before the next paint.
        queueMicrotask(() => setDismissed(true));
      }
    } catch {
      // Storage blocked: keep the banner showing.
    }
  }, []);

  /** Records a dismissal and hides the banner. */
  function handleDismiss(): void {
    try {
      window.localStorage.setItem(PROMO_DISMISSED_KEY, String(Date.now()));
    } catch {
      // Storage blocked: the dismissal lasts for this page view only.
    }
    setDismissed(true);
  }

  if (dismissed || hidden) return <></>;

  return (
    <div
      className={cn(
        "relative bg-mustard-300 text-russian-violet-900",
        // Right padding leaves room for the absolute-positioned dismiss button.
        "px-4 py-2 pr-12 text-center text-[0.9375rem] font-bold sm:px-12",
        "print:hidden",
      )}
    >
      {/* No aria-label: the visible offer is the link's name, so what a
          screen reader announces matches what a voice-control user says. */}
      <Link
        href="/pricing"
        className={cn(
          "block rounded hover:underline",
          "focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-russian-violet-900",
        )}
      >
        <FaBolt
          className="mr-2 inline-block h-4 w-4 text-russian-violet-900 sm:h-5 sm:w-5"
          aria-hidden="true"
        />
        <span className="font-bold">Limited offer:</span> {summariseForBanner(promo)}
        <span className="sr-only"> - see pricing details</span>
      </Link>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss promo banner"
        title="Dismiss"
        className={cn(
          // Pinned top-right so wrapping copy doesn't shove it mid-sentence on mobile.
          "group absolute top-1/2 right-2 -translate-y-1/2 sm:right-3",
          "inline-flex h-8 w-8 items-center justify-center rounded-full",
          // Keep the 32px pill visual but extend the tap target to 44px (older
          // audience, touch) via a transparent inset pseudo-element.
          "before:absolute before:-inset-1.5 before:content-['']",
          "bg-russian-violet-900/10 text-russian-violet-900",
          "ring-1 ring-russian-violet-900/20",
          "hover:bg-russian-violet-900 hover:text-mustard-300 hover:ring-russian-violet-900",
          "hover:scale-110 hover:rotate-90 active:scale-95",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-russian-violet-900/60",
          "transition-[background-color,color,box-shadow,scale,rotate] duration-200 ease-out",
        )}
      >
        <FaXmark className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
