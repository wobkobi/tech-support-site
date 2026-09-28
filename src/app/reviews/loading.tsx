// src/app/reviews/loading.tsx

import { PageLoadingShell } from "@/shared/components/PageLoadingShell";
import type React from "react";

/**
 * Reviews page route-loading spinner.
 * @returns Loading element.
 */
export default function ReviewsLoading(): React.ReactElement {
  return <PageLoadingShell label="reviews page" />;
}
