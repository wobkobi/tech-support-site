// src/app/admin/(shell)/mailing/[id]/page.tsx
// Admin editor for one mailing-list email or preset, with its recipients, presets, send setup and
// linked social post. `?draft=post` (from Email this too) opens Draft with AI on the post's words.

import { insertDetailsOf } from "@/features/admin/lib/insertables";
import { parseObjectId } from "@/features/business/lib/validation";
import {
  CampaignEditor,
  type LinkedPost,
  type SendRow,
} from "@/features/mailing/components/CampaignEditor";
import { toCampaignRow } from "@/features/mailing/lib/campaign-row";
import { missingSendEnv, promoWording } from "@/features/mailing/lib/context";
import { emailInsertGroups, emailLinkTargets } from "@/features/mailing/lib/insertables";
import { BLANK_TEMPLATE, type Template } from "@/features/mailing/lib/templates";
import { postBrief } from "@/features/social/lib/to-email";
import { aiConfigured } from "@/shared/lib/ai/json-completion";
import { requireAdminAuth } from "@/shared/lib/auth";
import { canUploadImages } from "@/shared/lib/image-upload";
import { prisma } from "@/shared/lib/prisma";
import { quietHoursOf } from "@/shared/lib/quiet-hours";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { getSiteUrl } from "@/shared/lib/site-url";
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
 * Templates for the dropdown: blank first, then presets oldest first.
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
 * The social post linked to an email, the first one when several were shared from it.
 * @param campaign - The email.
 * @param campaign.id - Its id.
 * @param campaign.createdAt - When it was made, to tell which came first.
 * @returns The post, or null.
 */
async function loadLinkedPost(campaign: {
  id: string;
  createdAt: Date;
}): Promise<LinkedPost | null> {
  const post = await prisma.socialPost.findFirst({
    where: { campaignId: campaign.id, isPreset: false },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      body: true,
      linkUrl: true,
      targets: true,
      isContent: true,
    },
  });
  if (!post) return null;
  const madeFromPost = post.createdAt < campaign.createdAt;
  return {
    id: post.id,
    name: post.name,
    isContent: post.isContent === true,
    madeFromPost,
    brief: madeFromPost ? postBrief(post) : "",
  };
}

/**
 * Admin email editor page.
 * @param props - Page props.
 * @param props.params - Route params with the campaign id.
 * @param props.searchParams - Query string; `draft=post` opens Draft with AI on the linked post.
 * @returns Editor page element.
 */
export default async function AdminMailingEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ draft?: string | string[] }>;
}): Promise<React.ReactElement> {
  await requireAdminAuth();
  const id = parseObjectId((await params).id);
  const campaign = id ? await prisma.campaign.findUnique({ where: { id } }) : null;
  if (!campaign) notFound();

  const isDraft = !campaign.isPreset && campaign.status === "draft";
  const draftFromPost = isDraft && (await searchParams).draft === "post";
  const [sends, { comms, identity, reviews }, promo, templates, wording, linkedPost] =
    await Promise.all([
      campaign.status === "draft" ? Promise.resolve([]) : loadSends(campaign.id),
      getSettings(),
      campaign.promoId
        ? prisma.promo.findUnique({ where: { id: campaign.promoId }, select: { title: true } })
        : Promise.resolve(null),
      isDraft ? loadTemplates() : Promise.resolve([]),
      promoWording(campaign.promoId),
      campaign.isPreset ? Promise.resolve(null) : loadLinkedPost(campaign),
    ]);
  const row = toCampaignRow(campaign);

  return (
    // Keyed on status and last save so router.refresh() remounts with fresh state. The
    // editor draws the page header too, since its Share to social button saves first.
    <CampaignEditor
      key={`${row.status}-${row.updatedAt}`}
      initial={row}
      sends={sends}
      insertGroups={emailInsertGroups(
        insertDetailsOf(identity, getSiteUrl()),
        wording.promo,
        reviews.googleReviewUrl,
      )}
      missingEnv={missingSendEnv()}
      canUpload={canUploadImages()}
      quiet={quietHoursOf(comms)}
      promoTitle={promo?.title ?? null}
      templates={templates}
      promo={wording.promo}
      linkTargets={emailLinkTargets(getSiteUrl(), reviews.googleReviewUrl)}
      canDraft={aiConfigured()}
      draftFromPost={draftFromPost && aiConfigured()}
      linkedPost={linkedPost}
      adminEmail={process.env.ADMIN_EMAIL?.trim() || null}
    />
  );
}
