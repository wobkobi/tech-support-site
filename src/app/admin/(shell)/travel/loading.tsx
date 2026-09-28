// src/app/admin/(shell)/travel/loading.tsx

import { LoadingSpinner } from "@/shared/components/LoadingSpinner";
import type React from "react";

/**
 * Travel blocks route-loading spinner.
 * @returns Loading element.
 */
export default function TravelLoading(): React.ReactElement {
  return <LoadingSpinner label="travel blocks" className="min-h-[60vh]" />;
}
