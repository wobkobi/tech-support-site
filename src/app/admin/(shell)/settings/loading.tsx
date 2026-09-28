// src/app/admin/(shell)/settings/loading.tsx

import { LoadingSpinner } from "@/shared/components/LoadingSpinner";
import type React from "react";

/**
 * Settings page route-loading spinner.
 * @returns Loading element.
 */
export default function SettingsLoading(): React.ReactElement {
  return <LoadingSpinner label="settings page" className="min-h-[60vh]" />;
}
