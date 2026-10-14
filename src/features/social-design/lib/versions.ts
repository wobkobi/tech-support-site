// src/features/social-design/lib/versions.ts
// Saved copies of a design for its History menu. Undo only lasts while the editor is
// open; these let the operator go back to how a design looked before an editing
// session, days later.

import { prisma } from "@/shared/lib/prisma";
import type { Prisma } from "@prisma/client";

/** Shortest gap between two saved copies of one design. */
const VERSION_GAP_MS = 5 * 60_000;
/** Copies kept per design; older ones are deleted. */
export const MAX_VERSIONS = 20;

/**
 * Saves the design as it is right now, before a save overwrites it, unless a copy was
 * saved in the last 5 minutes. Runs before the save, so the copy holds the design as it
 * stood at the start of an editing session rather than after its first change.
 * @param designId - Design id.
 */
export async function snapshotBeforeSave(designId: string): Promise<void> {
  const latest = await prisma.socialDesignVersion.findFirst({
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
