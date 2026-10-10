// src/app/admin/(shell)/layout.tsx
// Admin shell layout - renders AdminShell (sidebar, top bar and the padded content
// column), the toast provider and the phone + button once for every page in the (shell)
// group. The route group is transparent in the URL, so paths stay `/admin/...` unchanged.
//
// Auth stays PER-PAGE (`await requireAdminAuth(...)` as the first line of each page), NOT
// in this layout: layouts do not re-run on client-side navigation between sibling pages,
// so a layout-level gate would be a hole. The request-level gate is `src/proxy.ts`; the
// per-page checks are defence-in-depth.

import { AdminShell } from "@/features/admin/components/AdminShell";
import { MobileQuickActions } from "@/features/admin/components/MobileQuickActions";
import { AdminToastProvider } from "@/features/admin/components/ui/Toast";
import { SIDEBAR_COLLAPSED, SIDEBAR_COOKIE } from "@/features/admin/lib/sidebar-cookie";
import { PushRegistrar } from "@/features/notifications/components/PushRegistrar";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import type React from "react";

// Installing from the admin should produce a home-screen icon that opens the
// admin, not the public homepage the root manifest's start_url points at.
export const metadata: Metadata = {
  manifest: "/admin.webmanifest",
};

/**
 * Renders the admin chrome and the toast provider around every page in the
 * group. The desktop sidebar's collapsed state comes from the {@link SIDEBAR_COOKIE}
 * cookie (set by {@link AdminShell}), so the first paint already has the saved width.
 * @param props - Layout props.
 * @param props.children - The active admin page.
 * @returns The admin shell element.
 */
export default async function AdminShellLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const initialCollapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === SIDEBAR_COLLAPSED;
  return (
    <AdminToastProvider>
      <PushRegistrar />
      <AdminShell initialCollapsed={initialCollapsed}>{children}</AdminShell>
      <MobileQuickActions />
    </AdminToastProvider>
  );
}
