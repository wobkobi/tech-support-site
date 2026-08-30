// src/app/admin/(shell)/notifications/page.tsx
/**
 * @description Admin notifications page. Push state (permission, subscription,
 * whether the app is installed) lives entirely in the browser, so this is a
 * thin auth gate around {@link NotificationsView}.
 */
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { NotificationsView } from "@/features/notifications/components/NotificationsView";
import { requireAdminAuth } from "@/shared/lib/auth";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Notifications - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin Notifications page - per-device push setup and device management.
 * @returns Notifications page element.
 */
export default async function AdminNotificationsPage(): Promise<React.ReactElement> {
  await requireAdminAuth();

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Get a notification on your own devices when a booking arrives, changes, or a review comes in. Each device is set up separately - on iPhone the admin has to be added to the Home Screen first, because Safari tabs can't receive notifications."
      />
      <NotificationsView />
    </>
  );
}
