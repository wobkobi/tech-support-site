// src/shared/lib/settings/get-settings.ts
/**
 * @description Server-only accessor that resolves the full, typed settings:
 * code defaults with DB overrides merged on top, with the booking window
 * (maxAdvanceDays) defensively clamped so a hand-edited bad row can't push it
 * out of range on the public booking/pricing pages. Cached
 * via {@link unstable_cache} with a tag: hot reads hit the data cache, and
 * `saveSettingsGroup` busts the tag so edits go live immediately. The 60s
 * revalidate is only a cross-instance safety net.
 */

import { prisma } from "@/shared/lib/prisma";
import { DEFAULT_SETTINGS } from "@/shared/lib/settings/defaults";
import type { Settings, SettingsGroup } from "@/shared/lib/settings/types";
import { unstable_cache } from "next/cache";

/** Cache tag invalidated by `saveSettingsGroup` on every write. */
export const SETTINGS_TAG = "settings";
/** `Setting.key` prefix; one row per group (`settings:pricing`, etc.). */
export const SETTINGS_KEY_PREFIX = "settings:";

const GROUPS = Object.keys(DEFAULT_SETTINGS) as SettingsGroup[];

/**
 * True for a non-null, non-array object literal (a mergeable branch).
 * @param value - Candidate value.
 * @returns Whether `value` is a plain object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Overlays an override onto a base value. Plain objects merge recursively;
 * arrays and scalars (including an explicit `null`, used for "off") replace.
 * Override keys not present in the base shape are preserved as-is.
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
 * Read-side guards that keep an out-of-range stored value from breaking the
 * public site. Heavier coherence checks live in the write-path validator.
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
 * Pure resolver: merges a map of per-group overrides over the defaults. Shared
 * by the DB loader and unit tests (no Prisma, no cache).
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
 * Loads + merges the `settings:*` rows from MongoDB. Bad JSON in any row is
 * ignored so one corrupt row falls back to that group's default.
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
 * Cached accessor for the full settings object; the tag is busted on every
 * settings write so edits go live immediately.
 * @returns Resolved settings (defaults + DB overrides).
 */
export const getSettings = unstable_cache(loadSettings, ["settings"], {
  tags: [SETTINGS_TAG],
  revalidate: 60,
});
