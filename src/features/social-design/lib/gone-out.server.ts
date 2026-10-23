// src/features/social-design/lib/gone-out.server.ts
// Which designs have gone out: a picture of theirs is in an email that was sent or a post that
// went up. Those stay as they went out; changing one means making a copy and editing that.

import { prisma } from "@/shared/lib/prisma";
import type { CampaignStatus, SocialPostStatus } from "@prisma/client";

/** Where a design's pictures went out. */
export interface GoneOut {
  posts: { id: string; name: string }[];
  emails: { id: string; name: string }[];
}

/** A design as the check needs it. */
interface DesignUse {
  id: string;
  postId: string | null;
  renders: { url: string }[];
}

/** Post states that mean it went up on at least one app; a take-down still went out. */
const POSTED: SocialPostStatus[] = ["posting", "posted", "partial", "removing", "removed"];

/** Email states that mean it went to people. */
const SENT: CampaignStatus[] = ["sending", "sent"];

/** Widens the check from where pictures went out to anywhere they're used. */
interface UseScope {
  /** Count posts and emails in any state, drafts too. */
  anyState?: boolean;
  /** An email to leave out, like the one asking. */
  exceptEmail?: string;
}

/**
 * Where each design's pictures went out. A post counts when it shows one of the design's
 * pictures or is the post the design was made for; an email when its body holds a picture.
 * @param designs - The designs, with their exported pictures.
 * @param scope - What else counts.
 * @param scope.anyState - Count drafts and scheduled ones too, so it says where they're used.
 * @param scope.exceptEmail - An email whose use doesn't count.
 * @returns Each design that went out, by id; designs still free to edit are left out.
 */
export async function goneOut(
  designs: readonly DesignUse[],
  { anyState = false, exceptEmail }: UseScope = {},
): Promise<Map<string, GoneOut>> {
  const byUrl = new Map<string, string>();
  for (const d of designs) for (const r of d.renders) byUrl.set(r.url, d.id);
  const byPost = new Map(designs.flatMap((d) => (d.postId ? [[d.postId, d.id] as const] : [])));
  const urls = [...byUrl.keys()];
  const out = new Map<string, GoneOut>();
  if (urls.length === 0 && byPost.size === 0) return out;

  const [posts, emails] = await Promise.all([
    prisma.socialPost.findMany({
      where: {
        ...(anyState ? {} : { status: { in: POSTED } }),
        OR: [
          { id: { in: [...byPost.keys()] } },
          { imageUrl: { in: urls } },
          { targets: { some: { imageUrl: { in: urls } } } },
          { moreImages: { some: { url: { in: urls } } } },
        ],
      },
      select: { id: true, name: true, imageUrl: true, targets: true, moreImages: true },
    }),
    urls.length > 0
      ? prisma.campaign.findMany({
          where: {
            ...(anyState ? {} : { status: { in: SENT } }),
            ...(exceptEmail ? { id: { not: exceptEmail } } : {}),
            OR: urls.map((url) => ({ body: { contains: url } })),
          },
          select: { id: true, name: true, body: true },
        })
      : [],
  ]);

  /**
   * Records one use against a design.
   * @param designId - The design.
   * @param where - Posts or emails.
   * @param use - The post or email.
   * @param use.id - Its id.
   * @param use.name - Its name.
   */
  const add = (designId: string, where: keyof GoneOut, use: { id: string; name: string }): void => {
    const entry = out.get(designId) ?? { posts: [], emails: [] };
    if (!entry[where].some((u) => u.id === use.id)) entry[where].push(use);
    out.set(designId, entry);
  };
  for (const post of posts) {
    const shown = [
      post.imageUrl,
      ...post.targets.map((t) => t.imageUrl),
      ...post.moreImages.map((m) => m.url),
    ];
    const ids = new Set(shown.flatMap((url) => (url && byUrl.has(url) ? [byUrl.get(url)!] : [])));
    const madeFor = byPost.get(post.id);
    if (madeFor) ids.add(madeFor);
    for (const id of ids) add(id, "posts", { id: post.id, name: post.name });
  }
  for (const email of emails) {
    for (const [url, id] of byUrl) {
      if (email.body.includes(url)) add(id, "emails", { id: email.id, name: email.name });
    }
  }
  return out;
}

/**
 * Where one design went out. Templates never go out: a post or email uses a copy.
 * @param design - The design, with its exported pictures.
 * @returns Where it went out, or null while it's still free to edit.
 */
export async function designGoneOut(
  design: DesignUse & { isTemplate: boolean },
): Promise<GoneOut | null> {
  if (design.isTemplate) return null;
  return (await goneOut([design])).get(design.id) ?? null;
}

/** Why a design that went out can't be changed, for the routes that refuse it. */
export const GONE_OUT_ERROR =
  "This design has gone out, so it stays as it went out. Make a copy to change it.";
