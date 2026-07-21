// scripts/eval-ai/context.ts
// Reads live pricing context (benchmarks, min-billable, increment, rates,
// templates) so expected values track the operator's own settings and the eval
// never goes stale against a config change. Read-only. Resolves settings via
// the EXPORTED pure resolveSettings - NOT the unstable_cache-wrapped
// getSettings, which throws "incrementalCache missing" outside a Next.js
// request. The merge logic stays the server's single source of truth.

import { prisma } from "@/shared/lib/prisma";
import { resolveSettings, SETTINGS_KEY_PREFIX } from "@/shared/lib/settings/get-settings";
import type { Settings, SettingsGroup } from "@/shared/lib/settings/types";

/** Live values the harness derives expectations from. */
export interface LiveContext {
  benchmarks: { label: string; mins: number }[];
  minBillableMins: number;
  incrementMins: number;
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
 * Resolves settings the way the server does but without the unstable_cache
 * wrapper: reads the `settings:*` rows directly and merges them through the
 * exported pure {@link resolveSettings}, so the merge stays the single source
 * of truth. Mirrors the private `loadSettings` in get-settings.ts.
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
