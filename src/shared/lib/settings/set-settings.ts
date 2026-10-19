// src/shared/lib/settings/set-settings.ts
// Server-only writer for one settings group: upserts the row, appends a SettingAudit entry and
// busts the cache tag. Callers validate first.

import { prisma } from "@/shared/lib/prisma";
import { SETTINGS_KEY_PREFIX, SETTINGS_TAG } from "@/shared/lib/settings/get-settings";
import type { Settings, SettingsGroup } from "@/shared/lib/settings/types";
import { revalidateTag } from "next/cache";

/**
 * Stores one group's settings, logs an audit entry and revalidates the cache tag.
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
  const existing = await prisma.setting.findUnique({ where: { key } });
  await prisma.setting.upsert({
    where: { key },
    update: { value: json },
    create: { key, value: json },
  });
  // Append-only audit trail (backs the history panel + revert). Record only a
  // real change, and never let a logging failure fail the save itself.
  if (existing?.value !== json) {
    try {
      await prisma.settingAudit.create({
        data: { group, oldValue: existing?.value ?? null, newValue: json },
      });
    } catch (err) {
      console.error("[settings] Failed to write audit row:", err);
    }
  }
  // Next 16's revalidateTag requires a profile arg (see the promo/reviews routes).
  revalidateTag(SETTINGS_TAG, {});
}
