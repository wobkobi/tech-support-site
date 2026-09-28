// src/app/admin/(shell)/reviews/loading.tsx

import { LoadingSpinner } from "@/shared/components/LoadingSpinner";
import type React from "react";

/**
 * Reviews page route-loading spinner.
 * @returns Loading element.
 */
export default function ReviewsLoading(): React.ReactElement {
  return <LoadingSpinner label="reviews page" className="min-h-[60vh]" />;
}
