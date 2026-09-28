// src/app/services/loading.tsx

import { PageLoadingShell } from "@/shared/components/PageLoadingShell";
import type React from "react";

/**
 * Services page route-loading spinner.
 * @returns Loading element.
 */
export default function ServicesLoading(): React.ReactElement {
  return <PageLoadingShell label="services page" />;
}
