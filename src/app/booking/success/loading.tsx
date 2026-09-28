// src/app/booking/success/loading.tsx

import { PageLoadingShell } from "@/shared/components/PageLoadingShell";
import type React from "react";

/**
 * Booking confirmation route-loading spinner.
 * @returns Loading element.
 */
export default function BookingSuccessLoading(): React.ReactElement {
  return <PageLoadingShell label="booking confirmation" />;
}
