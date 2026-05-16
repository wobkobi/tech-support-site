"use client";
// src/shared/components/PromoBannerClient.tsx
/**
 * @file PromoBannerClient.tsx
 * @description Banner with 24h dismissal, first-load delay, and navbar offset coordination.
 */

import { useEffect, useRef, useState } from "react";
import type React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FaBolt, FaXmark } from "react-icons/fa6";
import { cn } from "@/shared/lib/cn";
import { summariseForBanner, type ActivePromo } from "@/features/business/lib/promos";

const PROMO_DISMISSED_KEY = "promo-banner-dismissed-at";
const PROMO_SEEN_KEY = "promo-banner-seen-at";
/** How long a dismissal sticks before the banner returns. */
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000;
/** Settle delay on a first-ever visit before the banner slides in. */
const FIRST_LOAD_DELAY_MS = 500;
/** Extra breathing room added below the banner before the navbar starts. */
const BANNER_GAP_PX = 8;

interface Props {
  promo: ActivePromo;
}

/**
 * Writes the navbar offset CSS variable in px (always with units so calc() works).
 * @param px - Total offset (banner height + breathing gap), or 0 to clear.
 */
function setNavOffset(px: number): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--promo-h", `${Math.max(0, px)}px`);
}

/**
 * Site-wide promo banner with dismissal + first-load animation.
 * @param props - Component props.
 * @param props.promo - Active promo from the server wrapper.
 * @returns Banner element.
 */
export function PromoBannerClient({ promo }: Props): React.ReactElement {
  const pathname = usePathname();
  // Admin pages have their own chrome - no public promo banner over the top.
  const hidden = pathname === "/admin" || pathname.startsWith("/admin/");

  // Both states start false on the server AND first client render so
  // hydration matches; the effect below syncs from localStorage on mount.
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const bannerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const dismissedAtRaw = window.localStorage.getItem(PROMO_DISMISSED_KEY);
    const dismissedAt = dismissedAtRaw ? Number(dismissedAtRaw) : 0;
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_TTL_MS) {
      // queueMicrotask defers the setState past the effect body, satisfying
      // the React lint while still firing before the next paint.
      queueMicrotask(() => setDismissed(true));
      return;
    }

    // Returning visitor: reveal immediately after hydration.
    if (window.localStorage.getItem(PROMO_SEEN_KEY)) {
      queueMicrotask(() => setVisible(true));
      return;
    }

    // First-ever visit: mark as seen and reveal after a brief settle delay.
    window.localStorage.setItem(PROMO_SEEN_KEY, String(Date.now()));
    const timer = window.setTimeout(() => setVisible(true), FIRST_LOAD_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // Measure the live banner height (which can change if copy wraps to two
  // lines on a narrow viewport) and write banner + gap into --promo-h so the
  // navbar's `top` always lines up. Reset when banner is hidden.
  useEffect(() => {
    if (hidden) {
      setNavOffset(0);
      return;
    }
    if (!visible || !bannerRef.current || typeof window === "undefined") return;
    const el = bannerRef.current;
    /**
     * Writes the banner's current height (plus the breathing gap) into the
     * shared CSS variable so the navbar slides to match.
     * @returns void
     */
    const update = (): void => setNavOffset(el.offsetHeight + BANNER_GAP_PX);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [visible, hidden]);

  /** Records a dismissal and animates the banner away. */
  function handleDismiss(): void {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PROMO_DISMISSED_KEY, String(Date.now()));
    }
    setVisible(false);
    setNavOffset(0);
  }

  // Dismissed users + admin routes render nothing.
  if (dismissed || hidden) return <></>;

  return (
    <div
      ref={bannerRef}
      className={cn(
        "z-60 fixed inset-x-0 top-0",
        // Matches the mustard strap on /pricing so both promo surfaces look the same.
        "bg-mustard-500 text-russian-violet-500",

        // Right padding leaves room for the absolute-positioned dismiss button.
        "px-4 py-2.5 pr-12 text-center text-base font-semibold sm:px-12 sm:text-lg",
        "transition-transform duration-500 ease-out",
        visible ? "translate-y-0" : "pointer-events-none -translate-y-full",
      )}
      role="status"
    >
      <Link
        href="/pricing"
        aria-label="See pricing details for the current offer"
        className={cn("block hover:underline focus:outline-none focus-visible:underline")}
      >
        <FaBolt
          className={cn("text-russian-violet-500 mr-2 inline-block h-4 w-4 sm:h-5 sm:w-5")}
          aria-hidden="true"
        />
        <span className={cn("font-bold")}>Limited offer:</span> {summariseForBanner(promo)}
      </Link>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss promo banner"
        title="Dismiss"
        className={cn(
          // Pinned top-right so wrapping copy doesn't shove it mid-sentence on mobile.
          "group absolute right-2 top-1/2 -translate-y-1/2 sm:right-3",
          "inline-flex h-8 w-8 items-center justify-center rounded-full",
          "bg-russian-violet-500/10 text-russian-violet-500",
          "ring-russian-violet-500/20 ring-1",
          "hover:bg-russian-violet-500 hover:text-mustard-500 hover:ring-russian-violet-500",
          "hover:rotate-90 hover:scale-110 active:scale-95",
          "focus-visible:ring-russian-violet-500/60 focus:outline-none focus-visible:ring-2",
          "transition-all duration-200 ease-out",
        )}
      >
        <FaXmark className={cn("h-4 w-4")} aria-hidden="true" />
      </button>
    </div>
  );
}
