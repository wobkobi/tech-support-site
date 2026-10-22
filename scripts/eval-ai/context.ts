// scripts/eval-ai/context.ts
// Reads live pricing and brand context so expectations track current settings. Uses the pure
// resolveSettings, since getSettings throws outside a Next.js request.

import { inWindowWhere } from "@/features/business/lib/promos";
import { prisma } from "@/shared/lib/prisma";
import { resolveSettings, SETTINGS_KEY_PREFIX } from "@/shared/lib/settings/get-settings";
import type { BrandProfile, Settings, SettingsGroup } from "@/shared/lib/settings/types";

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
  /** The brand profile the caption writer reads. */
  brand: BrandProfile;
  /** Whether an automatic promo is running, which the caption writer's PROMO section follows. */
  promoRunning: boolean;
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
 * Loads the live pricing and brand context from settings and the database.
 * @returns The current benchmarks, pricing floors, rates, templates, brand profile and promo state.
 */
export async function loadLiveContext(): Promise<LiveContext> {
  const [settings, rates, templates, promos] = await Promise.all([
    loadSettingsUncached(),
    prisma.rateConfig.findMany({ orderBy: { label: "asc" } }),
    prisma.taskTemplate.findMany(),
    prisma.promo.count({ where: inWindowWhere("automatic", new Date()) }),
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
    brand: settings.social.brand,
    promoRunning: promos > 0,
  };
}
