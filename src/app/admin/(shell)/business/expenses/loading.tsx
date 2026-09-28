// src/app/admin/(shell)/business/expenses/loading.tsx

import { LoadingSpinner } from "@/shared/components/LoadingSpinner";
import type React from "react";

/**
 * Expenses route-loading spinner.
 * @returns Loading element.
 */
export default function ExpensesLoading(): React.ReactElement {
  return <LoadingSpinner label="expenses" className="min-h-[60vh]" />;
}
