// src/app/admin/(shell)/loading.tsx

import { LoadingSpinner } from "@/shared/components/LoadingSpinner";
import type React from "react";

/**
 * Dashboard route-loading spinner.
 * @returns Loading element.
 */
export default function AdminDashboardLoading(): React.ReactElement {
  return <LoadingSpinner label="dashboard" className="min-h-[60vh]" />;
}
