// src/app/admin/(shell)/promos/loading.tsx

import { LoadingSpinner } from "@/shared/components/LoadingSpinner";
import type React from "react";

/**
 * Promos route-loading spinner.
 * @returns Loading element.
 */
export default function PromosLoading(): React.ReactElement {
  return <LoadingSpinner label="promos" className="min-h-[60vh]" />;
}
