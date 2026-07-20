"use client";
// src/app/booking/success/BookingConversion.tsx
/**
 * @description Reports a completed booking to GA4, Google Ads and the Meta
 * Pixel on the success page, at most once per booking per browser.
 */

import { useEffect } from "react";

// Scoped to the Production environment on Vercel, so preview deploys - which
// run the booking flow against test data - report no conversions.
const ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
const BOOKING_LABEL = process.env.NEXT_PUBLIC_GOOGLE_ADS_BOOKING_LABEL;
const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

/** Props for {@link BookingConversion}. */
interface BookingConversionProps {
  /**
   * Stable per-booking key for deduplication (the cancel token). Null when the
   * page rendered without one; the conversion then dedupes per session instead.
   */
  bookingRef: string | null;
  /** True when the visit came from editing an existing booking, not creating one. */
  edited: boolean;
}

/**
 * Fires the booking conversions once on mount: a GA4 `generate_lead` event, a
 * Google Ads conversion (when the Ads ID + label are set) and the Meta Pixel
 * `Lead` standard event (when the pixel is set), which matches the Leads
 * campaign objective; each half no-ops until its IDs are configured.
 *
 * Refreshes, bookmarked revisits and restored tabs must not double-count, so
 * each booking reports at most once per browser: localStorage remembers the
 * booking ref, and refs seen before are skipped. Without a ref the guard falls
 * back to once per session. Edits to an existing booking land on this page too
 * and are skipped outright - a reschedule is not a new lead. Renders no markup.
 * @param props - Component props.
 * @param props.bookingRef - Per-booking dedupe key, or null for the generic page.
 * @param props.edited - True when arriving from the edit-booking flow.
 * @returns Null - this component has no markup.
 */
export function BookingConversion({ bookingRef, edited }: BookingConversionProps): null {
  useEffect(() => {
    if (edited) return;

    // Dedupe guard. Storage can be unavailable (private mode, blocked); fall
    // through and fire anyway - occasional double-counting beats never counting.
    const key = `booking-conversion:${bookingRef ?? "no-ref"}`;
    const store = bookingRef ? "localStorage" : "sessionStorage";
    try {
      if (window[store].getItem(key)) return;
      window[store].setItem(key, "1");
    } catch {
      // Ignore - fire without the guard.
    }

    if (typeof window.gtag === "function") {
      // Plain GA4 lead event so bookings show up as a key event in Analytics,
      // not just as an Ads conversion.
      window.gtag("event", "generate_lead");
      if (ADS_ID && BOOKING_LABEL) {
        window.gtag("event", "conversion", { send_to: `${ADS_ID}/${BOOKING_LABEL}` });
      }
    }
    if (PIXEL_ID && typeof window.fbq === "function") {
      window.fbq("track", "Lead");
    }
  }, [bookingRef, edited]);

  return null;
}
