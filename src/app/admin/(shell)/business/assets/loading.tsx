// src/app/admin/(shell)/business/assets/loading.tsx
// Spinner while the asset register and its schedules load.

import { LoadingSpinner } from "@/shared/components/LoadingSpinner";
import type React from "react";

/**
 * Assets route-loading spinner.
 * @returns Loading element.
 */
export default function AssetsLoading(): React.ReactElement {
  return <LoadingSpinner label="assets" className="min-h-[60vh]" />;
}
