// src/app/admin/(shell)/bookings/[id]/loading.tsx

import { LoadingSpinner } from "@/shared/components/LoadingSpinner";
import type React from "react";

/**
 * Booking route-loading spinner.
 * @returns Loading element.
 */
export default function BookingDetailLoading(): React.ReactElement {
  return <LoadingSpinner label="booking" className="min-h-[60vh]" />;
}
