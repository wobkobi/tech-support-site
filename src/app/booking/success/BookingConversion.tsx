"use client";
// src/app/booking/success/BookingConversion.tsx
/**
 * @description Reports a completed booking to Google Ads and the Meta Pixel on
 * the success page.
 */

import { useEffect } from "react";

const ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
const BOOKING_LABEL = process.env.NEXT_PUBLIC_GOOGLE_ADS_BOOKING_LABEL;
const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

/**
 * Fires the booking conversions once on mount. This page renders only after a
 * booking is confirmed, so each event maps one-to-one to a real lead. Reports
 * an Ads conversion (when the Ads ID + label are set) and the Meta Pixel `Lead`
 * standard event (when the pixel is set), which matches the Leads campaign
 * objective; each half no-ops until its IDs are configured. Renders no markup.
 * @returns Null - this component has no markup.
 */
export function BookingConversion(): null {
  useEffect(() => {
    if (ADS_ID && BOOKING_LABEL && typeof window.gtag === "function") {
      window.gtag("event", "conversion", { send_to: `${ADS_ID}/${BOOKING_LABEL}` });
    }
    if (PIXEL_ID && typeof window.fbq === "function") {
      window.fbq("track", "Lead");
    }
  }, []);

  return null;
}
