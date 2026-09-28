// src/app/admin/(shell)/business/invoices/[id]/edit/loading.tsx

import { LoadingSpinner } from "@/shared/components/LoadingSpinner";
import type React from "react";

/**
 * Invoice editor route-loading spinner.
 * @returns Loading element.
 */
export default function EditInvoiceLoading(): React.ReactElement {
  return <LoadingSpinner label="invoice editor" className="min-h-[60vh]" />;
}
