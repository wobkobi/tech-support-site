// src/features/mailing/lib/presets.ts
// Starter presets for the mailing list. They are seeded into the database once, the first
// time the Mailing page opens, and from then on they're ordinary records the operator
// edits or deletes; nothing here is read again after seeding.

import { starterPresets } from "@/features/mailing/lib/starter-presets";
import { prisma } from "@/shared/lib/prisma";
import { getSiteUrl } from "@/shared/lib/site-url";

/** Setting key marking the starter presets as seeded, so deleted ones stay deleted. */
const SEEDED_KEY = "mailing:presetsSeeded";

/**
 * Seeds the starter presets the first time it runs, and never again. Creating
 * the marker row first doubles as a lock: its unique key makes a second
 * concurrent page load fail the create and skip the seeding.
 */
export async function ensureStarterPresets(): Promise<void> {
  const seeded = await prisma.setting.findUnique({ where: { key: SEEDED_KEY } });
  if (seeded) return;
  try {
    await prisma.setting.create({ data: { key: SEEDED_KEY, value: new Date().toISOString() } });
  } catch {
    return;
  }
  await prisma.campaign.createMany({
    data: starterPresets(getSiteUrl()).map((p) => ({
      ...p,
      preheader: p.preheader || null,
      isPreset: true,
    })),
  });
}
