// src/app/admin/(shell)/layout.tsx
// Admin shell layout: AdminShell, toasts and the phone + button for every (shell) page.
// Auth stays per-page: layouts don't re-run on client navigation (src/proxy.ts gates requests).

import { AdminShell } from "@/features/admin/components/AdminShell";
import { MobileQuickActions } from "@/features/admin/components/MobileQuickActions";
import { AdminToastProvider } from "@/features/admin/components/ui/Toast";
import { SIDEBAR_COLLAPSED, SIDEBAR_COOKIE } from "@/features/admin/lib/sidebar-cookie";
import { PushRegistrar } from "@/features/notifications/components/PushRegistrar";
import { cookies } from "next/headers";
import type React from "react";

/**
 * Renders the admin chrome around every page; the {@link SIDEBAR_COOKIE} cookie (set by
 * {@link AdminShell}) gives the first paint the saved sidebar width.
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
