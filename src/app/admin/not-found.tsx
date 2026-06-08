// src/app/admin/not-found.tsx
/**
 * @file not-found.tsx
 * @description Admin-styled 404 for /admin/* routes. Keeps the operator inside
 * the admin shell (sidebar + slate chrome) instead of dropping to the public
 * root 404, so a missing invoice/record still has the nav to recover from.
 */

import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import type React from "react";

/**
 * Admin not-found page.
 * @returns Admin 404 element.
 */
export default function AdminNotFound(): React.ReactElement {
  return (
    <AdminPageLayout current="dashboard">
      <div className={cn("mx-auto max-w-md py-16 text-center")}>
        <p className={cn("text-russian-violet text-5xl font-extrabold")}>404</p>
        <h1 className={cn("text-russian-violet mt-3 text-xl font-bold")}>Page not found</h1>
        <p className={cn("mt-2 text-sm text-slate-500")}>
          That admin page or record does not exist or has been removed.
        </p>
        <Link
          href="/admin"
          className={cn(
            "bg-russian-violet mt-6 inline-block rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90",
          )}
        >
          Back to dashboard
        </Link>
      </div>
    </AdminPageLayout>
  );
}
