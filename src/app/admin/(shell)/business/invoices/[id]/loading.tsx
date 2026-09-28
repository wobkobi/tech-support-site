// src/app/admin/(shell)/business/invoices/[id]/loading.tsx

import { LoadingSpinner } from "@/shared/components/LoadingSpinner";
import type React from "react";

/**
 * Invoice route-loading spinner.
 * @returns Loading element.
 */
export default function InvoiceDetailLoading(): React.ReactElement {
  return <LoadingSpinner label="invoice" className="min-h-[60vh]" />;
}
