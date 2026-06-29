// src/app/admin/not-found.tsx
/**
 * @description Admin-styled 404 for /admin/* routes. Keeps the operator inside
 * the admin shell (sidebar + slate chrome) instead of dropping to the public
 * root 404, so a missing invoice/record still has the nav to recover from.
 */

import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import Link from "next/link";
import type React from "react";

/**
 * Admin not-found page.
 * @returns Admin 404 element.
 */
export default function AdminNotFound(): React.ReactElement {
  return (
    <AdminPageLayout current="dashboard">
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-5xl font-extrabold text-russian-violet">404</p>
        <h1 className="mt-3 text-xl font-bold text-russian-violet">Page not found</h1>
        <p className="mt-2 text-sm text-slate-500">
          That admin page or record does not exist or has been removed.
        </p>
        <Link
          href="/admin"
          className="mt-6 inline-block rounded-lg bg-russian-violet px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          Back to dashboard
        </Link>
      </div>
    </AdminPageLayout>
  );
}
