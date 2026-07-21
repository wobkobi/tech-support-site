// src/app/admin/(shell)/layout.tsx
/**
 * @description Admin shell layout - renders the sidebar, the padded content
 * column, and the toast provider once for every page in the (shell) group. The
 * route group is transparent in the URL, so paths stay `/admin/...` unchanged.
 * The chrome that used to live in AdminPageLayout per-page now lives here.
 *
 * Auth stays PER-PAGE (`await requireAdminAuth(...)` as the first line of each
 * page), NOT in this layout: layouts do not re-run on client-side navigation
 * between sibling pages, so a layout-level gate would be a hole. The
 * request-level gate is `src/proxy.ts`; the per-page checks are defence-in-depth.
 */

import { AdminSidebar } from "@/features/admin/components/AdminSidebar";
import { AdminToastProvider } from "@/features/admin/components/ui/Toast";
import type React from "react";

/**
 * Renders the admin chrome (sidebar + content column) and the toast provider
 * around every page in the group.
 * @param props - Layout props.
 * @param props.children - The active admin page.
 * @returns The admin shell element.
 */
export default function AdminShellLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <AdminToastProvider>
      <div className="flex min-h-screen overflow-x-clip">
        <AdminSidebar />
        {/* Sidebar is fixed-position; reserve its width on lg+ only (mobile uses
            the drawer). min-w-0 stops wide content blowing out the flex column;
            overflow-x-clip preserves sticky descendants. Print drops the chrome. */}
        <div className="min-w-0 flex-1 bg-slate-50 lg:ml-56 print:ml-0 print:bg-white">
          <div className="px-4 pt-16 pb-8 sm:px-6 sm:pt-8 lg:pt-8 print:p-0">{children}</div>
        </div>
      </div>
    </AdminToastProvider>
  );
}
