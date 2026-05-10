// src/app/booking/layout.tsx
/**
 * @file layout.tsx
 * @description Booking route segment layout. Google Maps is no longer loaded
 *   here - AddressAutocomplete injects the script lazily when the address input
 *   becomes visible (and only for in-person bookings). The preconnect hint
 *   warms the TLS handshake so the lazy injection feels instant when it fires.
 */

import type React from "react";

/**
 * Booking layout wrapper with a preconnect to Google Maps origins.
 * @param props - Layout props.
 * @param props.children - Child content.
 * @returns Layout element.
 */
export default function BookingLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <>
      <link rel="preconnect" href="https://maps.googleapis.com" crossOrigin="anonymous" />
      <link rel="preconnect" href="https://maps.gstatic.com" crossOrigin="anonymous" />
      <link rel="dns-prefetch" href="https://maps.googleapis.com" />
      {children}
    </>
  );
}
