// src/app/booking/edit/loading.tsx

import { PageLoadingShell } from "@/shared/components/PageLoadingShell";
import type React from "react";

/**
 * Booking edit loading spinner.
 * @returns Loading element.
 */
export default function BookingEditLoading(): React.ReactElement {
  return <PageLoadingShell label="booking" cardPage />;
}
