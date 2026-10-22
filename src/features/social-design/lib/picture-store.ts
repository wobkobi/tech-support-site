// src/features/social-design/lib/picture-store.ts
// Server-side writes for a design's exported pictures: swapping one size's picture without
// disturbing the editor's save guard, and deleting exports and videos nothing uses any more.

import { isRenderUrl } from "@/features/social-design/lib/pictures";
import { isVideoFile } from "@/features/social/lib/media";
import { prisma } from "@/shared/lib/prisma";
import type { DesignRender, SocialDesign } from "@prisma/client";
import { del } from "@vercel/blob";

/**
 * Changes a design's exports or post link without bumping updatedAt, which would make the next
 * autosave a false "changed in another tab". Written conditionally, re-read on a race.
 * @param id - Design id.
 * @param change - Given the stored design, the fields to write.
 * @returns The design as it was before the write, or null when it doesn't exist.
 */
export async function writeKeepingUpdatedAt(
  id: string,
  change: (design: SocialDesign) => { renders?: DesignRender[]; postId?: string | null },
): Promise<SocialDesign | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const design = await prisma.socialDesign.findUnique({ where: { id } });
    if (!design) return null;
    const result = await prisma.socialDesign.updateMany({
      where: { id, updatedAt: design.updatedAt },
      data: { ...change(design), updatedAt: design.updatedAt },
    });
    if (result.count > 0) return design;
  }
  throw new Error(`Design ${id} kept changing while its pictures were stored.`);
}

/**
 * Deletes exported pictures, uploaded videos and their cover frames from Blob once nothing points
 * at them: no post (any of its pictures or its video), design, email or email preset. Uploaded
 * photos are never touched. Failures are logged, never thrown.
 * @param urls - Addresses that may have fallen out of use.
 */
export async function deleteUnusedMedia(urls: (string | null | undefined)[]): Promise<void> {
  const candidates = [...new Set(urls)].filter(
    (u): u is string => typeof u === "string" && (isRenderUrl(u) || isVideoFile(u)),
  );
  for (const url of candidates) {
    try {
      const [posts, designs, emails] = await Promise.all([
        prisma.socialPost.count({
          where: {
            OR: [
              { imageUrl: url },
              { targets: { some: { imageUrl: url } } },
              { moreImages: { some: { url } } },
              { video: { is: { url } } },
              { video: { is: { coverUrl: url } } },
            ],
          },
        }),
        prisma.socialDesign.count({ where: { renders: { some: { url } } } }),
        prisma.campaign.count({ where: { body: { contains: url } } }),
      ]);
      if (posts === 0 && designs === 0 && emails === 0) await del(url);
    } catch (error) {
      console.error(`[social-design] couldn't clean up ${url}:`, error);
    }
  }
}
