// src/app/admin/(shell)/notifications/loading.tsx

import { LoadingSpinner } from "@/shared/components/LoadingSpinner";
import type React from "react";

/**
 * Notifications route-loading spinner.
 * @returns Loading element.
 */
export default function NotificationsLoading(): React.ReactElement {
  return <LoadingSpinner label="notifications" className="min-h-[60vh]" />;
}
