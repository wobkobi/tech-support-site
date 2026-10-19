// src/features/social-design/templates/seed.ts
// Seeds starter templates on first Post maker open. Each key's Setting marker is the seed lock and
// outlives the template, so deletions stick; a reworked template gets a new key.

import { starterTemplates } from "@/features/social-design/templates/starters";
import { prisma } from "@/shared/lib/prisma";
import { getSiteUrl } from "@/shared/lib/site-url";
import type { Prisma } from "@prisma/client";

const MARKER_PREFIX = "social-design:template:";

/** Creates any starter template not seeded before. */
export async function ensureStarterTemplates(): Promise<void> {
  const templates = starterTemplates({ bookingUrl: `${getSiteUrl()}/booking` });
  const markers = await prisma.setting.findMany({
    where: { key: { in: templates.map((t) => MARKER_PREFIX + t.templateKey) } },
    select: { key: true },
  });
  const seeded = new Set(markers.map((m) => m.key));
  // Last first: the list shows the newest row first, so this keeps the starter order.
  for (const t of templates.toReversed()) {
    const key = MARKER_PREFIX + t.templateKey;
    if (seeded.has(key)) continue;
    try {
      await prisma.setting.create({ data: { key, value: new Date().toISOString() } });
    } catch {
      // Another request took the marker first and is seeding this one.
      continue;
    }
    await prisma.socialDesign.create({
      data: {
        name: t.name,
        kind: t.kind,
        isTemplate: true,
        templateKey: t.templateKey,
        doc: t.doc as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
