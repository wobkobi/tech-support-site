// src/app/admin/(shell)/settings/page.tsx
/**
 * @description Admin settings panel. Loads the resolved settings server-side and
 * hands each editable group, paired with its {@link DEFAULT_SETTINGS} fallback,
 * to the tabbed {@link SettingsView} client component.
 */
import { SettingsView } from "@/features/admin/components/settings/SettingsView";
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { requireAdminAuth } from "@/shared/lib/auth";
import { DEFAULT_SETTINGS } from "@/shared/lib/settings/defaults";
import { getSettings } from "@/shared/lib/settings/get-settings";
import type { Metadata } from "next";
import type React from "react";

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
    <>
      <PageHeader
        title="Settings"
        description="Change the values your site runs on without editing code. Each field explains what it does; edits go live as soon as you save."
      />
      <SettingsView
        availability={settings.availability}
        availabilityDefaults={DEFAULT_SETTINGS.availability}
        pricing={settings.pricing}
        pricingDefaults={DEFAULT_SETTINGS.pricing}
        estimator={settings.estimator}
        estimatorDefaults={DEFAULT_SETTINGS.estimator}
        comms={settings.comms}
        commsDefaults={DEFAULT_SETTINGS.comms}
        reviews={settings.reviews}
        reviewsDefaults={DEFAULT_SETTINGS.reviews}
        identity={settings.identity}
        identityDefaults={DEFAULT_SETTINGS.identity}
        tax={settings.tax}
        taxDefaults={DEFAULT_SETTINGS.tax}
        scheduling={settings.scheduling}
        schedulingDefaults={DEFAULT_SETTINGS.scheduling}
      />
    </>
  );
}
