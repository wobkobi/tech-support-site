// src/app/admin/(shell)/business/trips/loading.tsx
// Spinner while the trips page loads its FY data.

import { LoadingSpinner } from "@/shared/components/LoadingSpinner";
import type React from "react";

/**
 * Trips route-loading spinner.
 * @returns Loading element.
 */
export default function TripsLoading(): React.ReactElement {
  return <LoadingSpinner label="trips" className="min-h-[60vh]" />;
}
