// src/app/review/loading.tsx

import { PageLoadingShell } from "@/shared/components/PageLoadingShell";
import type React from "react";

/**
 * Review page route-loading spinner.
 * @returns Loading element.
 */
export default function ReviewLoading(): React.ReactElement {
  return <PageLoadingShell label="review page" />;
}
