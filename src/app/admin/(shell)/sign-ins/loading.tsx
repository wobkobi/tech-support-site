// src/app/admin/(shell)/sign-ins/loading.tsx

import { LoadingSpinner } from "@/shared/components/LoadingSpinner";
import type React from "react";

/**
 * Sign-ins route-loading spinner.
 * @returns Loading element.
 */
export default function SignInsLoading(): React.ReactElement {
  return <LoadingSpinner label="sign-ins" className="min-h-[60vh]" />;
}
