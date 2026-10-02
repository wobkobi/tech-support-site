// src/app/admin/(shell)/settings/page.tsx
// Admin settings panel. Loads the resolved settings server-side and hands each editable
// group, paired with its DEFAULT_SETTINGS fallback, to the tabbed SettingsView client
// component, along with the rate rows for the Rates tab. `?tab=` opens a given tab.

import {
  SettingsView,
  type SettingsTabKey,
} from "@/features/admin/components/settings/SettingsView";
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import type { RateConfig } from "@/features/business/types/business";
import { requireAdminAuth } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { DEFAULT_SETTINGS } from "@/shared/lib/settings/defaults";
import { getSettings } from "@/shared/lib/settings/get-settings";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings - Admin",
  robots: { index: false, follow: false },
};

/** Tabs `?tab=` may name. */
const TAB_KEYS = new Set<string>([
  "availability",
  "pricing",
  "rates",
  "estimator",
  "identity",
  "tax",
  "comms",
  "scheduling",
  "reviews",
]);

/**
 * Admin settings panel - loads the resolved settings and the rate rows server-side and
 * hands them to the tabbed client view.
 * @param props - Page props.
 * @param props.searchParams - Query string; `tab` picks the tab to open on.
 * @returns Settings page element.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}): Promise<React.ReactElement> {
  await requireAdminAuth();
  const [settings, rateRows, params] = await Promise.all([
    getSettings(),
    prisma.rateConfig.findMany({ orderBy: { label: "asc" } }),
    searchParams,
  ]);
  const tab = typeof params.tab === "string" && TAB_KEYS.has(params.tab) ? params.tab : undefined;
  // Flatten Dates to the ISO strings the client type expects.
  const rates: RateConfig[] = rateRows.map((r) => ({
    id: r.id,
    label: r.label,
    ratePerHour: r.ratePerHour,
    flatRate: r.flatRate,
    hourlyDelta: r.hourlyDelta,
    percentDelta: r.percentDelta,
    unit: r.unit,
    isDefault: r.isDefault,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <>
      <PageHeader
        title="Settings"
        description="Change the values your site runs on without editing code. Edits go live as soon as you save."
      />
      <SettingsView
        initialTab={tab as SettingsTabKey | undefined}
        rates={rates}
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
