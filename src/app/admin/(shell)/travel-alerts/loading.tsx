// src/app/admin/(shell)/travel-alerts/loading.tsx

import { LoadingSpinner } from "@/shared/components/LoadingSpinner";
import type React from "react";

/**
 * Travel alerts route-loading spinner.
 * @returns Loading element.
 */
export default function TravelAlertsLoading(): React.ReactElement {
  return <LoadingSpinner label="travel alerts" className="min-h-[60vh]" />;
}
