// src/app/booking/layout.tsx
// Booking layout: preconnect to Google Maps so AddressAutocomplete's lazy script load is fast.

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
