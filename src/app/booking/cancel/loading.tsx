// src/app/booking/cancel/loading.tsx

import { PageLoadingShell } from "@/shared/components/PageLoadingShell";
import type React from "react";

/**
 * Booking cancellation route-loading spinner.
 * @returns Loading element.
 */
export default function BookingCancelLoading(): React.ReactElement {
  return <PageLoadingShell label="booking cancellation" />;
}
