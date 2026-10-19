// src/features/business/lib/task-taxonomy.ts
// Pure task-tag helpers. Tags are case-insensitive everywhere ("PC" and "Pc" are ONE tag), so
// every list must collapse casings or a Clear on one silently takes the other.

/** Which tag axis to read or rename. */
export type TaxonomyAxis = "device" | "action";

/** Minimum {@link collectTaxonomyTags} needs from a template row. */
export interface TaxonomyRow {
  device?: string | null;
  action?: string | null;
  usageCount: number;
}

/** One tag as the operator sees it, plus any rival casings still stored. */
export interface TaxonomyTag {
  /** Canonical spelling - the casing carried by the busiest rows. */
  name: string;
  /** Other casings of the same tag still in the data; empty when consistent. */
  variants: string[];
}

/**
 * Collapses one axis into the operator's tag list: one entry per case-insensitive tag, spelt
 * as its busiest rows spell it, with rival casings listed alongside.
 * @param rows - Template rows to read the axis from.
 * @param axis - Whether to collect device tags or action tags.
 * @returns Canonical tags with their rival casings, sorted case-insensitively.
 */
export function collectTaxonomyTags(
  rows: readonly TaxonomyRow[],
  axis: TaxonomyAxis,
): TaxonomyTag[] {
  // Lowercased tag > spelling > total usage sitting behind that spelling.
  const groups = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const value = row[axis]?.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    const spellings = groups.get(key) ?? new Map<string, number>();
    spellings.set(value, (spellings.get(value) ?? 0) + Math.max(row.usageCount, 0));
    groups.set(key, spellings);
  }

  const tags: TaxonomyTag[] = [];
  for (const spellings of groups.values()) {
    // Busiest spelling wins; ties go to code-unit order, so "TV" beats "Tv".
    const ranked = [...spellings.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const [winner, ...rest] = ranked;
    if (!winner) continue;
    tags.push({ name: winner[0], variants: rest.map(([spelling]) => spelling) });
  }

  return tags.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/**
 * Snaps a case-variant of a known tag onto its stored casing; unknown tags pass through
 * trimmed, as the vocabulary stays open.
 * @param tag - Device or action tag, from the operator or the AI.
 * @param known - Lowercased tag > canonical casing, from {@link canonicalTagMap}.
 * @returns Canonical tag, or null when the input was empty.
 */
export function canonicaliseTag(
  tag: string | null | undefined,
  known: Map<string, string>,
): string | null {
  const trimmed = tag?.trim();
  if (!trimmed) return null;
  return known.get(trimmed.toLowerCase()) ?? trimmed;
}

/**
 * Lowercased tag > canonical spelling, for snapping new tags onto existing casing.
 * @param rows - Template rows to read the axis from.
 * @param axis - Whether to map device tags or action tags.
 * @returns Lookup keyed by the lowercased tag.
 */
export function canonicalTagMap(
  rows: readonly TaxonomyRow[],
  axis: TaxonomyAxis,
): Map<string, string> {
  return new Map(collectTaxonomyTags(rows, axis).map((tag) => [tag.name.toLowerCase(), tag.name]));
}
