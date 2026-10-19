// src/features/social-design/lib/versions.ts
// Saved copies for a design's History menu, outlasting the editor's in-session undo.

import { prisma } from "@/shared/lib/prisma";
import type { Prisma } from "@prisma/client";

/** Shortest gap between two saved copies of one design. */
const VERSION_GAP_MS = 5 * 60_000;
/** Copies kept per design; older ones are deleted. */
export const MAX_VERSIONS = 20;

/**
 * Saves the design before a save overwrites it, unless copied in the last 5 minutes, so the copy
 * holds the start of an editing session.
 * @param designId - Design id.
 * @param always - Skip the 5-minute gap, for "Use in post".
 */
export async function snapshotBeforeSave(designId: string, always = false): Promise<void> {
  const latest = always
    ? null
    : await prisma.socialDesignVersion.findFirst({
        where: { designId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
  if (latest && Date.now() - latest.createdAt.getTime() < VERSION_GAP_MS) return;
  const current = await prisma.socialDesign.findUnique({
    where: { id: designId },
    select: { name: true, doc: true },
  });
  if (!current) return;
  await prisma.socialDesignVersion.create({
    data: { designId, name: current.name, doc: current.doc as Prisma.InputJsonValue },
  });
  const stale = await prisma.socialDesignVersion.findMany({
    where: { designId },
    orderBy: { createdAt: "desc" },
    skip: MAX_VERSIONS,
    select: { id: true },
  });
  if (stale.length > 0) {
    await prisma.socialDesignVersion.deleteMany({ where: { id: { in: stale.map((v) => v.id) } } });
  }
}
