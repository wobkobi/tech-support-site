// src/app/admin/(shell)/business/income/loading.tsx

import { LoadingSpinner } from "@/shared/components/LoadingSpinner";
import type React from "react";

/**
 * Income route-loading spinner.
 * @returns Loading element.
 */
export default function IncomeLoading(): React.ReactElement {
  return <LoadingSpinner label="income" className="min-h-[60vh]" />;
}
