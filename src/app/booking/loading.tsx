// src/app/booking/loading.tsx

import { PageLoadingShell } from "@/shared/components/PageLoadingShell";
import type React from "react";

/**
 * Booking page route-loading spinner.
 * @returns Loading element.
 */
export default function BookingLoading(): React.ReactElement {
  return <PageLoadingShell label="booking page" />;
}
