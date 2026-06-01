// src/shared/lib/settings/set-settings.ts
/**
 * @file set-settings.ts
 * @description Server-only writer for a single settings group. Upserts the
 * `settings:<group>` row then busts the `settings` cache tag so the change is
 * live immediately. Callers (the admin API route) validate the payload first.
 */

import { revalidateTag } from "next/cache";
import { prisma } from "@/shared/lib/prisma";
import { SETTINGS_KEY_PREFIX, SETTINGS_TAG } from "@/shared/lib/settings/get-settings";
import type { Settings, SettingsGroup } from "@/shared/lib/settings/types";

/**
 * Persists one group's settings and revalidates the cache tag.
 * @param group - Which settings group to write.
 * @param value - The validated, full value for that group.
 * @returns Resolves once stored and the tag is busted.
 */
export async function saveSettingsGroup<G extends SettingsGroup>(
  group: G,
  value: Settings[G],
): Promise<void> {
  const key = SETTINGS_KEY_PREFIX + group;
  const json = JSON.stringify(value);
  await prisma.setting.upsert({
    where: { key },
    update: { value: json },
    create: { key, value: json },
  });
  // Next 16's revalidateTag requires a profile arg (see the promo/reviews routes).
  revalidateTag(SETTINGS_TAG, {});
}
