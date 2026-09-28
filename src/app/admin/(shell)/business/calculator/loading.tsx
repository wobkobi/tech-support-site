// src/app/admin/(shell)/business/calculator/loading.tsx

import { LoadingSpinner } from "@/shared/components/LoadingSpinner";
import type React from "react";

/**
 * Job calculator route-loading spinner.
 * @returns Loading element.
 */
export default function CalculatorLoading(): React.ReactElement {
  return <LoadingSpinner label="job calculator" className="min-h-[60vh]" />;
}
