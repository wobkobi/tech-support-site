// src/app/admin/(shell)/business/tax/loading.tsx
// Route-loading spinner for the Tax page while the estimate is computed.

import { LoadingSpinner } from "@/shared/components/LoadingSpinner";
import type React from "react";

/**
 * Tax route-loading spinner.
 * @returns Loading element.
 */
export default function TaxLoading(): React.ReactElement {
  return <LoadingSpinner label="tax page" className="min-h-[60vh]" />;
}
