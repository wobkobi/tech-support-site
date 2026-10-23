// src/features/social/lib/email-step.server.ts
// Server-only: Email this too. Makes a draft mailing-list email from a post, links the two, and
// reads the link back for the composer. Nothing here sends anything.

import { docHash, parseDesignDoc, type BoundValues } from "@/features/social-design/lib/doc";
import { EMAIL_PICTURE_FORMAT } from "@/features/social-design/lib/formats";
import { loadBoundValues } from "@/features/social-design/lib/load-bound";
import { autoAltText } from "@/features/social-design/lib/pictures";
import { writePostMeta } from "@/features/social/lib/post-meta.server";
import { emailFromPost, postBrief } from "@/features/social/lib/to-email";
import { isBlobImageUrl } from "@/shared/lib/blob-image";
import { prisma } from "@/shared/lib/prisma";
import type { CampaignStatus, SocialDesign, SocialPost } from "@prisma/client";

/** Where the email's picture comes from. */
export type EmailPictureSource = "design" | "photo" | "none";

/** A picture an email can open with. */
export interface EmailPicture {
  url: string;
  alt: string;
}

/** The email linked to a post, as the composer shows it. */
export interface PostEmail {
  id: string;
  name: string;
  status: CampaignStatus;
  scheduledAt: string | null;
  sentAt: string | null;
  /** The post was shared from this email, rather than the email made from the post. */
  fromEmail: boolean;
}

/** What drafting an email from a post came to. */
export type DraftEmailResult =
  { ok: true; campaignId: string } | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * A design's wide picture for email, when it still matches the design and the live contact and
 * promo details. Alt text is the design's own, or one made from its headline.
 * @param design - The design as stored.
 * @param bound - Live bound values, from loadBoundValues.
 * @returns The picture, or null when there's no current wide one.
 */
export function designEmailPicture(design: SocialDesign, bound: BoundValues): EmailPicture | null {
  const parsed = parseDesignDoc(design.doc);
  if ("error" in parsed) return null;
  const hash = docHash(parsed.doc, bound);
  const wide = design.renders.find((r) => r.format === EMAIL_PICTURE_FORMAT && r.docHash === hash);
  if (!wide) return null;
  return {
    url: wide.url,
    alt: (parsed.doc.altText.trim() || autoAltText(parsed.doc)).slice(0, 200),
  };
}

/**
 * The email linked to a post, or null when there's none or it has been deleted.
 * @param post - The post as stored.
 * @returns The linked email.
 */
export async function loadPostEmail(post: SocialPost): Promise<PostEmail | null> {
  if (!post.campaignId) return null;
  const campaign = await prisma.campaign.findUnique({ where: { id: post.campaignId } });
  if (!campaign) return null;
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    scheduledAt: campaign.scheduledAt?.toISOString() ?? null,
    sentAt: campaign.sentAt?.toISOString() ?? null,
    fromEmail: campaign.createdAt <= post.createdAt,
  };
}

/**
 * The picture to open the email with.
 * @param post - The post.
 * @param source - Which picture was picked.
 * @returns The picture, null for none, or an error to show.
 */
async function pickPicture(
  post: SocialPost,
  source: EmailPictureSource,
): Promise<EmailPicture | null | { error: string }> {
  if (source === "none") return null;
  if (source === "photo") {
    if (!post.imageUrl || !isBlobImageUrl(post.imageUrl)) {
      return { error: "This post has no picture to use." };
    }
    return { url: post.imageUrl, alt: post.imageAlt?.trim() ?? "" };
  }
  const design = await prisma.socialDesign.findFirst({
    where: { postId: post.id, isTemplate: false },
    orderBy: { updatedAt: "desc" },
  });
  const picture = design ? designEmailPicture(design, await loadBoundValues()) : null;
  return (
    picture ?? {
      error:
        "The design's wide picture is missing or out of date. Save its pictures in the Post maker, or pick another picture.",
    }
  );
}

/**
 * Makes a draft email from a post and links it, so the post and the email point at each other.
 * The email starts as a plain copy of the post's words; Draft with AI in Mailing can rewrite it.
 * A link that still points at a live email is never replaced, so two tabs can't make two.
 * @param id - Post id.
 * @param opts - Options.
 * @param opts.picture - Where the email's picture comes from.
 * @returns The new email's id, or an error.
 */
export async function draftEmailForPost(
  id: string,
  opts: { picture: EmailPictureSource },
): Promise<DraftEmailResult> {
  const post = await prisma.socialPost.findUnique({ where: { id } });
  if (!post) return { ok: false, status: 404, error: "Post not found." };
  if (post.isPreset) {
    return { ok: false, status: 400, error: "Start a post from this preset to email it." };
  }
  const linked = post.campaignId
    ? await prisma.campaign.findUnique({ where: { id: post.campaignId }, select: { id: true } })
    : null;
  if (linked) return { ok: false, status: 409, error: "This post already has an email." };

  const brief = postBrief(post);
  if (!brief) {
    return {
      ok: false,
      status: 400,
      error: "Write the post first: the email is made from its words.",
    };
  }
  const picture = await pickPicture(post, opts.picture);
  if (picture && "error" in picture) return { ok: false, status: 400, error: picture.error };

  const { subject, body } = emailFromPost(post, picture);
  const created = await prisma.campaign.create({
    data: {
      name: `Email: ${post.name}`.slice(0, 120),
      subject,
      body,
      promoId: post.promoId,
    },
  });

  // Only the link seen above may be replaced: a deleted email's, or none.
  const seen = post.campaignId;
  const outcome = await writePostMeta(id, (p) =>
    p.campaignId && p.campaignId !== seen ? null : { campaignId: created.id },
  );
  if (outcome !== "done") {
    await prisma.campaign.delete({ where: { id: created.id } });
    return outcome === "missing"
      ? { ok: false, status: 404, error: "Post not found." }
      : { ok: false, status: 409, error: "This post already has an email." };
  }
  return { ok: true, campaignId: created.id };
}

/**
 * Marks whether Email this too was turned down for a post.
 * @param id - Post id.
 * @param skipped - True to stop offering it after publishing.
 * @returns False when the post is gone.
 */
export async function setEmailSkipped(id: string, skipped: boolean): Promise<boolean> {
  return (await writePostMeta(id, () => ({ emailSkipped: skipped }))) === "done";
}

/**
 * Unlinks a post from its email. The email itself stays in Mailing.
 * @param id - Post id.
 * @returns False when the post is gone.
 */
export async function unlinkPostEmail(id: string): Promise<boolean> {
  return (await writePostMeta(id, () => ({ campaignId: null }))) === "done";
}
