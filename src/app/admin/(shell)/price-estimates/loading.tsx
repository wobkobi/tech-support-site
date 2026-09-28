// src/app/admin/(shell)/price-estimates/loading.tsx

import { LoadingSpinner } from "@/shared/components/LoadingSpinner";
import type React from "react";

/**
 * Price estimates route-loading spinner.
 * @returns Loading element.
 */
export default function PriceEstimatesLoading(): React.ReactElement {
  return <LoadingSpinner label="price estimates" className="min-h-[60vh]" />;
}
