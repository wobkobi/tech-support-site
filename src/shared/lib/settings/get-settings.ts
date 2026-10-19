// src/shared/lib/settings/get-settings.ts
// Server-only typed settings: defaults plus DB overrides, maxAdvanceDays clamped. Cached by tag,
// busted on save. No time-based revalidate: the root layout reads this, so a timer would become
// every public page's ISR interval. A row edited straight in the DB needs a settings save.

import { prisma } from "@/shared/lib/prisma";
import { DEFAULT_SETTINGS } from "@/shared/lib/settings/defaults";
import type { Settings, SettingsGroup } from "@/shared/lib/settings/types";
import { isPlainObject } from "@/shared/lib/settings/validate";
import { unstable_cache } from "next/cache";

/** Cache tag invalidated by `saveSettingsGroup` on every write. */
export const SETTINGS_TAG = "settings";
/** `Setting.key` prefix; one row per group (`settings:pricing`, etc.). */
export const SETTINGS_KEY_PREFIX = "settings:";

const GROUPS = Object.keys(DEFAULT_SETTINGS) as SettingsGroup[];

/**
 * Overlays an override onto a base: plain objects merge recursively; arrays, scalars and an
 * explicit `null` ("off") replace. Extra override keys are kept.
 * @param base - Default value for this branch.
 * @param override - Stored override (may be partial or undefined).
 * @returns Merged value of the base's type.
 */
function deepMerge<T>(base: T, override: unknown): T {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) return override as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    out[key] = key in base ? deepMerge((base as Record<string, unknown>)[key], value) : value;
  }
  return out as T;
}

/**
 * Clamps a number into a range, falling back when it isn't finite.
 * @param n - Candidate value.
 * @param min - Lower bound.
 * @param max - Upper bound.
 * @param fallback - Used when `n` is NaN/Infinity.
 * @returns A finite number within `[min, max]`.
 */
function clamp(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Read-side clamps so a bad stored value can't break the public site.
 * @param s - Freshly merged settings (mutated in place).
 * @returns The same settings, clamped.
 */
function sanitiseSettings(s: Settings): Settings {
  s.availability.maxAdvanceDays = clamp(
    s.availability.maxAdvanceDays,
    1,
    365,
    DEFAULT_SETTINGS.availability.maxAdvanceDays,
  );
  return s;
}

/**
 * Pure resolver merging per-group overrides over the defaults; shared by the loader and tests.
 * @param overrides - Parsed override JSON keyed by group (missing groups use defaults).
 * @returns Fully-resolved, clamped settings.
 */
export function resolveSettings(overrides: Partial<Record<SettingsGroup, unknown>>): Settings {
  // Build into a plain record (deepMerge preserves each group's default type),
  // then assert to Settings once every group has been populated.
  const merged: Record<string, unknown> = {};
  for (const group of GROUPS) {
    merged[group] = deepMerge(DEFAULT_SETTINGS[group], overrides[group]);
  }
  return sanitiseSettings(merged as unknown as Settings);
}

/**
 * Loads and merges `settings:*` rows; a row with bad JSON falls back to its group default.
 * @returns Resolved settings.
 */
async function loadSettings(): Promise<Settings> {
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
 * Cached settings accessor; every settings write busts the tag.
 * @returns Resolved settings (defaults + DB overrides).
 */
export const getSettings = unstable_cache(loadSettings, ["settings"], {
  tags: [SETTINGS_TAG],
  revalidate: false,
});
