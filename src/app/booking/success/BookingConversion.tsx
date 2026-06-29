"use client";
// src/app/booking/success/BookingConversion.tsx
/**
 * @description Reports a completed booking to Google Ads on the success page.
 */

import { useEffect } from "react";

const ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
const BOOKING_LABEL = process.env.NEXT_PUBLIC_GOOGLE_ADS_BOOKING_LABEL;

/**
 * Fires the Ads booking conversion once on mount. This page renders only after
 * a booking is confirmed, so the event maps one-to-one to a real lead. Renders
 * no markup, and no-ops until the Ads ID + label are configured.
 * @returns Null - this component has no markup.
 */
export function BookingConversion(): null {
  useEffect(() => {
    if (!ADS_ID || !BOOKING_LABEL || typeof window.gtag !== "function") return;
    window.gtag("event", "conversion", { send_to: `${ADS_ID}/${BOOKING_LABEL}` });
  }, []);

  return null;
}
