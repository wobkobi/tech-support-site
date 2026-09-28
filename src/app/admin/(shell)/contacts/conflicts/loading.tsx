// src/app/admin/(shell)/contacts/conflicts/loading.tsx

import { LoadingSpinner } from "@/shared/components/LoadingSpinner";
import type React from "react";

/**
 * Contact conflicts route-loading spinner.
 * @returns Loading element.
 */
export default function ConflictsLoading(): React.ReactElement {
  return <LoadingSpinner label="contact conflicts" className="min-h-[60vh]" />;
}
