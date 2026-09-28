// src/app/business/loading.tsx

import { PageLoadingShell } from "@/shared/components/PageLoadingShell";
import type React from "react";

/**
 * Business page route-loading spinner.
 * @returns Loading element.
 */
export default function BusinessLoading(): React.ReactElement {
  return <PageLoadingShell label="business page" />;
}
