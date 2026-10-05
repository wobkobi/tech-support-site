// src/app/admin/(shell)/mailing/[id]/page.tsx
// Admin editor for one mailing-list email or preset. Loads the email, who it went
// to (once sent), the presets for the template dropdown, the quiet-hours window and
// which env vars sending still needs.

import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { parseObjectId } from "@/features/business/lib/validation";
import { CampaignEditor, type SendRow } from "@/features/mailing/components/CampaignEditor";
import { toCampaignRow } from "@/features/mailing/lib/campaign-row";
import { missingSendEnv } from "@/features/mailing/lib/context";
import { PLACEHOLDERS } from "@/features/mailing/lib/render";
import { BLANK_TEMPLATE, type Template } from "@/features/mailing/lib/templates";
import { requireAdminAuth } from "@/shared/lib/auth";
import { canUploadImages } from "@/shared/lib/image-upload";
import { prisma } from "@/shared/lib/prisma";
import { quietHoursOf } from "@/shared/lib/quiet-hours";
import { getSettings } from "@/shared/lib/settings/get-settings";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Edit email - Admin",
  robots: { index: false, follow: false },
};

/**
 * Loads each recipient's copy with the contact's current name.
 * @param campaignId - Campaign id.
 * @returns Rows, failures first so they're easy to spot.
 */
async function loadSends(campaignId: string): Promise<SendRow[]> {
  const rows = await prisma.campaignSend.findMany({ where: { campaignId } });
  const contacts = await prisma.contact.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.contactId))] } },
    select: { id: true, name: true },
  });
  const names = new Map(contacts.map((c) => [c.id, c.name]));
  const order = { failed: 0, pending: 1, sent: 2 } as const;
  return rows
    .map((r) => ({
      id: r.id,
      name: names.get(r.contactId) ?? "Deleted contact",
      email: r.email,
      status: r.status,
      error: r.error,
    }))
    .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
}

/**
 * Templates for the dropdown on a draft: blank first, then the presets oldest first
 * so the starter set keeps its order.
 * @returns Blank plus every preset.
 */
async function loadTemplates(): Promise<Template[]> {
  const presets = await prisma.campaign.findMany({
    where: { isPreset: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, subject: true, preheader: true, body: true },
  });
  return [BLANK_TEMPLATE, ...presets.map((p) => ({ ...p, preheader: p.preheader ?? "" }))];
}

/**
 * Admin email editor page.
 * @param props - Page props.
 * @param props.params - Route params with the campaign id.
 * @returns Editor page element.
 */
export default async function AdminMailingEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  await requireAdminAuth();
  const id = parseObjectId((await params).id);
  const campaign = id ? await prisma.campaign.findUnique({ where: { id } }) : null;
  if (!campaign) notFound();

  const isDraft = !campaign.isPreset && campaign.status === "draft";
  const [sends, { comms }, promo, templates] = await Promise.all([
    campaign.status === "draft" ? Promise.resolve([]) : loadSends(campaign.id),
    getSettings(),
    campaign.promoId
      ? prisma.promo.findUnique({ where: { id: campaign.promoId }, select: { title: true } })
      : Promise.resolve(null),
    isDraft ? loadTemplates() : Promise.resolve([]),
  ]);
  const row = toCampaignRow(campaign);

  return (
    <>
      <PageHeader
        title={campaign.name}
        breadcrumbs={[{ label: "Mailing list", href: "/admin/mailing" }, { label: campaign.name }]}
      />
      {/* Keyed on status and last save: router.refresh() after a send or schedule
          change remounts the editor with the new state instead of keeping stale fields. */}
      <CampaignEditor
        key={`${row.status}-${row.updatedAt}`}
        initial={row}
        sends={sends}
        placeholders={PLACEHOLDERS.map((p) => ({ key: p.key, help: p.help }))}
        missingEnv={missingSendEnv()}
        canUpload={canUploadImages()}
        quiet={quietHoursOf(comms)}
        promoTitle={promo?.title ?? null}
        templates={templates}
        adminEmail={process.env.ADMIN_EMAIL?.trim() || null}
      />
    </>
  );
}
