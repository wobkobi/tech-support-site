// src/features/mailing/lib/presets.ts
// Starter presets for the mailing list. They are seeded into the database the first time
// the Mailing page opens, and from then on they're ordinary records the operator edits or
// deletes. Presets added later (V2_PRESET_KEYS) are seeded once more on their own,
// so an install that already had the first set gets the new ones without its deleted or
// edited presets coming back.

import {
  starterPresets,
  V2_PRESET_KEYS,
  type StarterPreset,
} from "@/features/mailing/lib/starter-presets";
import { prisma } from "@/shared/lib/prisma";
import { getSiteUrl } from "@/shared/lib/site-url";
import type { Prisma } from "@prisma/client";

/** Setting key marking the first starter set as seeded, so deleted ones stay deleted. */
const SEEDED_KEY = "mailing:presetsSeeded";
/** Setting key marking the later presets as seeded. */
const SEEDED_V2_KEY = "mailing:presetsSeeded:v2";

/**
 * Claims a seeding step. Creating the marker row doubles as a lock: its unique key
 * makes a second concurrent page load fail the create and skip the step.
 * @param key - The step's marker key.
 * @returns True when this call should do the seeding.
 */
async function claim(key: string): Promise<boolean> {
  const seeded = await prisma.setting.findUnique({ where: { key } });
  if (seeded) return false;
  try {
    await prisma.setting.create({ data: { key, value: new Date().toISOString() } });
    return true;
  } catch {
    return false;
  }
}

/**
 * Campaign rows for starter presets.
 * @param presets - The presets to create.
 * @returns Rows for createMany.
 */
function presetRows(presets: StarterPreset[]): Prisma.CampaignCreateManyInput[] {
  return presets.map((p) => ({ ...p, preheader: p.preheader || null, isPreset: true }));
}

/**
 * Seeds the starter presets that haven't been seeded yet, each set exactly once. A fresh
 * install gets everything in the first step and marks the later step done too.
 */
export async function ensureStarterPresets(): Promise<void> {
  const all = starterPresets(getSiteUrl());
  if (await claim(SEEDED_KEY)) {
    await claim(SEEDED_V2_KEY);
    await prisma.campaign.createMany({ data: presetRows(all) });
    return;
  }
  if (!(await claim(SEEDED_V2_KEY))) return;
  // Skip any key already present, in case one was made by hand before this step ran.
  const existing = await prisma.campaign.findMany({
    where: { isPreset: true, presetKey: { in: [...V2_PRESET_KEYS] } },
    select: { presetKey: true },
  });
  const have = new Set(existing.map((c) => c.presetKey));
  const missing = all.filter((p) => V2_PRESET_KEYS.includes(p.presetKey) && !have.has(p.presetKey));
  if (missing.length > 0) await prisma.campaign.createMany({ data: presetRows(missing) });
}
