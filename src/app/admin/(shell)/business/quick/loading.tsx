// src/app/admin/(shell)/business/quick/loading.tsx

import { LoadingSpinner } from "@/shared/components/LoadingSpinner";
import type React from "react";

/**
 * Quick price route-loading spinner.
 * @returns Loading element.
 */
export default function QuickPriceLoading(): React.ReactElement {
  return <LoadingSpinner label="quick price" className="min-h-[60vh]" />;
}
