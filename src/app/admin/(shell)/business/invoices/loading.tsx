// src/app/admin/(shell)/business/invoices/loading.tsx

import { LoadingSpinner } from "@/shared/components/LoadingSpinner";
import type React from "react";

/**
 * Invoices route-loading spinner.
 * @returns Loading element.
 */
export default function InvoicesLoading(): React.ReactElement {
  return <LoadingSpinner label="invoices" className="min-h-[60vh]" />;
}
