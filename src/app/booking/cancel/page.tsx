// src/app/booking/cancel/page.tsx
// Booking cancel page. Server shell so the phone number comes from live settings; the
// flow itself lives in CancelContent.

import { getIdentity } from "@/shared/lib/business-identity.server";
import type { Metadata } from "next";
import type React from "react";
import { Suspense } from "react";
import { CancelContent } from "./CancelContent";

// Token-gated cancellation flow reached from booking emails: keep it out of
// search results.
export const metadata: Metadata = {
  title: "Cancel booking",
  robots: { index: false, follow: false },
};

/**
 * Booking cancel page. {@link Suspense} is required because {@link CancelContent}
 * reads the token from the search params.
 * @returns The cancel page element.
 */
export default async function BookingCancelPage(): Promise<React.ReactElement> {
  const identity = await getIdentity();
  return (
    <Suspense>
      <CancelContent phone={identity.phone} phoneTel={identity.phoneTel} />
    </Suspense>
  );
}
