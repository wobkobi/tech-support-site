// src/app/admin/(shell)/mailing/page.tsx
// Admin mailing list page. Seeds the starter presets on the first visit, then loads
// every email and the subscriber lists for MailingView.

import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { MailingView } from "@/features/mailing/components/MailingView";
import { toCampaignRow } from "@/features/mailing/lib/campaign-row";
import { ensureStarterPresets } from "@/features/mailing/lib/presets";
import { loadRecipients } from "@/features/mailing/lib/recipients";
import { requireAdminAuth } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mailing list - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin Mailing page.
 * @returns Mailing page element.
 */
export default async function AdminMailingPage(): Promise<React.ReactElement> {
  await requireAdminAuth();
  await ensureStarterPresets();

  const [campaigns, { recipients, optedOut }] = await Promise.all([
    prisma.campaign.findMany({ orderBy: { updatedAt: "desc" } }),
    loadRecipients(),
  ]);

  return (
    <>
      <PageHeader
        title="Mailing list"
        description="Write emails to everyone you've helped: promos, holiday hours, scam warnings and anything else. Each one has an unsubscribe link."
      />
      <MailingView
        initial={campaigns.map(toCampaignRow)}
        subscribed={recipients}
        unsubscribed={optedOut}
      />
    </>
  );
}
