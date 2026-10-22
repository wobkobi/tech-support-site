// src/features/social/lib/starter-content.server.ts
// Server-only: adds the starter content set to the library, skipping items already imported and
// making any tags they need.

import {
  STARTER_CONTENT,
  planStarterImport,
  starterItemFields,
} from "@/features/social/lib/starter-content";
import { tagKey } from "@/features/social/lib/tags";
import { addTag } from "@/features/social/lib/tags.server";
import { prisma } from "@/shared/lib/prisma";
import { acquireRunLock, releaseRunLock } from "@/shared/lib/run-lock";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { getSiteUrl } from "@/shared/lib/site-url";

/** Run lock, so two clicks at once can't add the set twice. */
const IMPORT_LOCK = "social:starterImport";

/** What an import came to. */
export type StarterImportResult =
  { ok: true; created: number; skipped: number } | { ok: false; error: string };

/**
 * Adds every starter item that isn't in the library yet. Each one keeps its key as starterKey, so
 * an item already imported, even renamed or edited, is skipped; one that was deleted comes back.
 * @returns How many were added and skipped, or why it couldn't run.
 */
export async function importStarterContent(): Promise<StarterImportResult> {
  if (!(await acquireRunLock(IMPORT_LOCK, 60_000))) {
    return { ok: false, error: "The starter content is already being added. Try again shortly." };
  }
  try {
    const keys = STARTER_CONTENT.map((i) => i.key);
    const [existing, tags, settings] = await Promise.all([
      prisma.socialPost.findMany({
        where: { starterKey: { in: keys } },
        select: { starterKey: true },
      }),
      prisma.socialTag.findMany({ select: { id: true, name: true, key: true } }),
      getSettings(),
    ]);
    const plan = planStarterImport(
      STARTER_CONTENT,
      new Set(existing.flatMap((p) => (p.starterKey ? [p.starterKey] : []))),
      tags.map((t) => t.name),
    );

    const tagIds = new Map(tags.map((t) => [t.key, t.id]));
    for (const name of plan.newTags) {
      const added = await addTag({ name });
      if (!added.ok) return { ok: false, error: added.error };
      tagIds.set(tagKey(name), added.tag.id);
    }

    const site = getSiteUrl();
    const links = {
      booking: `${site}/booking`,
      about: `${site}/about`,
      review: settings.reviews.googleReviewUrl.trim() || `${site}/review`,
    };
    if (plan.create.length > 0) {
      await prisma.socialPost.createMany({
        data: plan.create.map((item) => ({
          ...starterItemFields(item, links),
          tagIds: item.tags.flatMap((name) => tagIds.get(tagKey(name)) ?? []),
        })),
      });
    }
    return { ok: true, created: plan.create.length, skipped: plan.skipped.length };
  } finally {
    await releaseRunLock(IMPORT_LOCK);
  }
}
