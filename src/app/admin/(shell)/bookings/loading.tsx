// src/app/admin/(shell)/bookings/loading.tsx

import { LoadingSpinner } from "@/shared/components/LoadingSpinner";
import type React from "react";

/**
 * Bookings route-loading spinner.
 * @returns Loading element.
 */
export default function BookingsLoading(): React.ReactElement {
  return <LoadingSpinner label="bookings" className="min-h-[60vh]" />;
}
