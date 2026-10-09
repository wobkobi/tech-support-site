// src/app/admin/login/loading.tsx
// Full-screen spinner for the sign-in page. Overrides the admin (shell) loading state so
// the login route doesn't flash the operator panel layout.

import { LoadingSpinner } from "@/shared/components/LoadingSpinner";
import type React from "react";

/**
 * Sign-in page route-loading spinner.
 * @returns Loading element.
 */
export default function AdminLoginLoading(): React.ReactElement {
  return <LoadingSpinner label="sign-in page" className="min-h-screen bg-admin-bg" />;
}
