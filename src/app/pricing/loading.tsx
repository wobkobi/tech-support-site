// src/app/pricing/loading.tsx

import { PageLoadingShell } from "@/shared/components/PageLoadingShell";
import type React from "react";

/**
 * Pricing page route-loading spinner.
 * @returns Loading element.
 */
export default function PricingLoading(): React.ReactElement {
  return <PageLoadingShell label="pricing page" />;
}
