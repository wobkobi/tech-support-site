// src/app/admin/(shell)/business/loading.tsx

import { LoadingSpinner } from "@/shared/components/LoadingSpinner";
import type React from "react";

/**
 * Business page route-loading spinner.
 * @returns Loading element.
 */
export default function BusinessLoading(): React.ReactElement {
  return <LoadingSpinner label="business page" className="min-h-[60vh]" />;
}
