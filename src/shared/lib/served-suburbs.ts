// src/shared/lib/served-suburbs.ts
// Parses the "Served suburbs" setting: one suburb per line, and a line ending in ":" starts a region.

import { DEFAULT_SETTINGS } from "@/shared/lib/settings/defaults";
import type { IdentitySettings } from "@/shared/lib/settings/types";

export interface SuburbGroup {
  /** Region heading, or null for suburbs listed before any heading. */
  region: string | null;
  suburbs: string[];
}

/**
 * Groups lines under region headings, keeping each suburb's first mention and dropping empty headings.
 * @param lines - Raw textarea lines as stored in settings.
 * @returns Non-empty groups in list order.
 */
export function groupServedSuburbs(lines: readonly string[]): SuburbGroup[] {
  const groups: SuburbGroup[] = [];
  const seen = new Set<string>();
  let current: SuburbGroup = { region: null, suburbs: [] };
  groups.push(current);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.endsWith(":")) {
      current = { region: line.slice(0, -1).trim() || null, suburbs: [] };
      groups.push(current);
      continue;
    }
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    current.suburbs.push(line);
  }
  return groups.filter((g) => g.suburbs.length > 0);
}

/**
 * Live suburb groups, falling back to the defaults when the stored list is empty.
 * @param identity - Resolved identity settings.
 * @returns Non-empty suburb groups.
 */
export function servedSuburbGroups(identity: IdentitySettings): SuburbGroup[] {
  const groups = groupServedSuburbs(identity.servedSuburbs);
  return groups.length ? groups : groupServedSuburbs(DEFAULT_SETTINGS.identity.servedSuburbs);
}
