// src/app/booking/layout.tsx
/**
 * @file layout.tsx
 * @description Booking page layout with Google Maps Places API
 */

import type React from "react";
import Script from "next/script";

/**
 * Booking layout that loads Google Maps Places API
 * @param props - Layout props
 * @param props.children - Child components
 * @returns Layout wrapper with Google Maps script
 */
export default function BookingLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  return (
    <>
      {googleMapsApiKey && (
        <Script
          src={`https://maps.googleapis.com/maps/api/js?key=${googleMapsApiKey}&libraries=places`}
          strategy="beforeInteractive"
        />
      )}
      {children}
    </>
  );
}
