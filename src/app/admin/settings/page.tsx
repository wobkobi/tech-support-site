// src/app/admin/settings/page.tsx
import type { Metadata } from "next";
import type React from "react";
import { requireAdminAuth } from "@/shared/lib/auth";
import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import { cn } from "@/shared/lib/cn";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { DEFAULT_SETTINGS } from "@/shared/lib/settings/defaults";
import { SettingsView } from "@/features/admin/components/settings/SettingsView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin settings panel - loads the resolved settings server-side and hands the
 * editable groups to the tabbed client view. Only the pricing tab is wired so
 * far; the others render a placeholder until their step lands.
 * @returns Settings page element.
 */
export default async function SettingsPage(): Promise<React.ReactElement> {
  await requireAdminAuth();
  const settings = await getSettings();

  return (
    <AdminPageLayout current="settings">
      <h1 className={cn("text-russian-violet mb-1 text-2xl font-extrabold")}>Settings</h1>
      <p className={cn("mb-6 text-sm text-slate-500")}>
        Change the values your site runs on without editing code. Each field explains what it does;
        edits go live as soon as you save.
      </p>
      <SettingsView
        availability={settings.availability}
        availabilityDefaults={DEFAULT_SETTINGS.availability}
        pricing={settings.pricing}
        pricingDefaults={DEFAULT_SETTINGS.pricing}
        comms={settings.comms}
        commsDefaults={DEFAULT_SETTINGS.comms}
        reviews={settings.reviews}
        reviewsDefaults={DEFAULT_SETTINGS.reviews}
        holds={settings.holds}
        holdsDefaults={DEFAULT_SETTINGS.holds}
        identity={settings.identity}
        identityDefaults={DEFAULT_SETTINGS.identity}
      />
    </AdminPageLayout>
  );
}
