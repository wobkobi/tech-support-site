// src/app/admin/login/loading.tsx
/**
 * @file loading.tsx
 * @description Streaming skeleton for the admin sign-in page. Overrides the
 * admin sidebar skeleton with the centred login card (slate theme), so the
 * login route doesn't flash the operator-panel layout.
 */

import { Bone } from "@/shared/components/Skeleton";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/**
 * Admin login route-loading skeleton.
 * @returns Skeleton element.
 */
export default function AdminLoginLoading(): React.ReactElement {
  return (
    <div
      className={cn("flex min-h-screen items-center justify-center bg-slate-50 p-6")}
      role="status"
      aria-live="polite"
      aria-label="Loading sign-in page"
    >
      <div
        className={cn("w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm")}
      >
        <Bone className={cn("mb-2 h-6 w-40 bg-slate-200")} />
        <Bone className={cn("mb-5 h-4 w-full max-w-xs bg-slate-200")} />
        <Bone className={cn("mb-3 h-11 w-full bg-slate-200")} />
        <Bone className={cn("h-11 w-full bg-slate-200")} />
      </div>
      <span className={cn("sr-only")}>Loading sign-in page...</span>
    </div>
  );
}
