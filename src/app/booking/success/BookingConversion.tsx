"use client";
// src/app/booking/success/BookingConversion.tsx
// Reports a completed booking to GA4, Google Ads and the Meta Pixel on the success page,
// at most once per booking per browser.

import { useEffect } from "react";

// Production-only env on Vercel, so preview deploys report no conversions.
const ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
const BOOKING_LABEL = process.env.NEXT_PUBLIC_GOOGLE_ADS_BOOKING_LABEL;
const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

/** Props for {@link BookingConversion}. */
interface BookingConversionProps {
  /** Per-booking dedupe key (the cancel token); null dedupes per session instead. */
  bookingRef: string | null;
  /** True when the visit came from editing an existing booking, not creating one. */
  edited: boolean;
}

/**
 * Fire GA4 `generate_lead`, the Ads conversion and Meta Pixel `Lead` once per booking
 * per browser (localStorage by ref). Edits are skipped: a reschedule is not a new lead.
 * @param props - Component props.
 * @param props.bookingRef - Per-booking dedupe key, or null for the generic page.
 * @param props.edited - True when arriving from the edit-booking flow.
 * @returns Null - this component has no markup.
 */
export function BookingConversion({ bookingRef, edited }: BookingConversionProps): null {
  useEffect(() => {
    if (edited) return;

    // Without storage, fire anyway: double-counting beats never counting.
    const key = `booking-conversion:${bookingRef ?? "no-ref"}`;
    const store = bookingRef ? "localStorage" : "sessionStorage";
    try {
      if (window[store].getItem(key)) return;
      window[store].setItem(key, "1");
    } catch {
      // Ignore - fire without the guard.
    }

    if (typeof window.gtag === "function") {
      // GA4 lead event so bookings are a key event in Analytics too.
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
