// src/shared/lib/served-suburbs.ts
// Parses the admin "Served suburbs" list. One suburb per line; a line ending in a
// colon ("North Shore:") starts a region that the suburbs below it belong to. The
// Services page renders the groups, the JSON-LD areaServed uses the flat list.

import { DEFAULT_SETTINGS } from "@/shared/lib/settings/defaults";
import type { IdentitySettings } from "@/shared/lib/settings/types";

export interface SuburbGroup {
  /** Region heading, or null for suburbs listed before any heading. */
  region: string | null;
  suburbs: string[];
}

/**
 * Groups raw lines under their region headings. Blank lines are ignored, a
 * suburb repeated anywhere in the list is kept only at its first mention
 * (case-insensitive), and a heading with no suburbs under it is dropped.
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
 * Live suburb groups for an identity, falling back to the default list when the
 * stored one holds no suburbs (an identity row seeded before servedSuburbs
 * existed stores [], which would otherwise blank every consumer).
 * @param identity - Resolved identity settings.
 * @returns Non-empty suburb groups.
 */
export function servedSuburbGroups(identity: IdentitySettings): SuburbGroup[] {
  const groups = groupServedSuburbs(identity.servedSuburbs);
  return groups.length ? groups : groupServedSuburbs(DEFAULT_SETTINGS.identity.servedSuburbs);
}
