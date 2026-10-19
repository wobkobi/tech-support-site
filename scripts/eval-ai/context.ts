// scripts/eval-ai/context.ts
// Reads live pricing context so expectations track current settings. Uses the pure
// resolveSettings, since getSettings throws outside a Next.js request.

import { prisma } from "@/shared/lib/prisma";
import { resolveSettings, SETTINGS_KEY_PREFIX } from "@/shared/lib/settings/get-settings";
import type { Settings, SettingsGroup } from "@/shared/lib/settings/types";

/** Live values the harness derives expectations from. */
export interface LiveContext {
  benchmarks: { label: string; mins: number }[];
  minBillableMins: number;
  incrementMins: number;
  maxJobMins: number;
  rates: {
    id: string;
    label: string;
    ratePerHour: number | null;
    hourlyDelta: number | null;
    isDefault: boolean;
  }[];
  templates: { device: string | null; action: string | null }[];
}

/**
 * Resolves settings like the server, without unstable_cache: reads `settings:*` rows and
 * merges them through {@link resolveSettings}.
 * @returns Fully-resolved settings (defaults + DB overrides).
 */
async function loadSettingsUncached(): Promise<Settings> {
  const rows = await prisma.setting.findMany({
    where: { key: { startsWith: SETTINGS_KEY_PREFIX } },
  });
  const overrides: Partial<Record<SettingsGroup, unknown>> = {};
  for (const row of rows) {
    const group = row.key.slice(SETTINGS_KEY_PREFIX.length) as SettingsGroup;
    try {
      overrides[group] = JSON.parse(row.value);
    } catch {
      // Leave the group on its default if the stored JSON is unparseable.
    }
  }
  return resolveSettings(overrides);
}

/**
 * Loads the live pricing context from settings and the database.
 * @returns The current benchmarks, pricing floors, rates, and templates.
 */
export async function loadLiveContext(): Promise<LiveContext> {
  const [settings, rates, templates] = await Promise.all([
    loadSettingsUncached(),
    prisma.rateConfig.findMany({ orderBy: { label: "asc" } }),
    prisma.taskTemplate.findMany(),
  ]);
  return {
    benchmarks: settings.estimator.benchmarks,
    minBillableMins: settings.pricing.minBillableMins,
    incrementMins: settings.pricing.billingIncrementMins,
    maxJobMins: settings.pricing.maxJobMins,
    rates: rates.map((r) => ({
      id: r.id,
      label: r.label,
      ratePerHour: r.ratePerHour,
      hourlyDelta: r.hourlyDelta,
      isDefault: r.isDefault,
    })),
    templates: templates.map((t) => ({ device: t.device, action: t.action })),
  };
}
