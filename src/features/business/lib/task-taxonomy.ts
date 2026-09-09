// src/features/business/lib/task-taxonomy.ts
// Tag identity is case-insensitive everywhere it counts: parse-job snaps emitted tags by
// lowercase, `findTemplateByTags` matches by lowercase, and both `renameTaxonomyTag` and the
// clear endpoints match with `mode: "insensitive"`. Casing is therefore presentation only -
// "PC" and "Pc" are ONE tag, so every list built off these fields has to collapse them, or a
// Clear aimed at one entry silently takes the other too.
//
// Pure helpers only, so client components can share them; the Prisma side lives in
// task-taxonomy.server.ts.

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
 * Collapses one axis of a template set into the tag list the operator sees: one
 * entry per case-insensitive tag, spelt the way its busiest rows spell it, with
 * the rival casings listed alongside so a split spelling stays visible rather
 * than hidden. Listing the variants as separate entries would offer two handles
 * on one tag - see the file header for why acting on either hits both.
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
    // Busiest spelling wins. Ties fall to code-unit order, which is stable across
    // reloads and puts the all-caps form of an acronym ("TV" over "Tv") first.
    const ranked = [...spellings.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const [winner, ...rest] = ranked;
    if (!winner) continue;
    tags.push({ name: winner[0], variants: rest.map(([spelling]) => spelling) });
  }

  return tags.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/**
 * Snaps one tag onto the taxonomy's spelling: a case-variant of a known tag
 * takes the stored casing, so a near-duplicate can't split the vocabulary or
 * the price memory. Unknown tags pass through trimmed - the vocabulary stays
 * open, and callers surface a new tag as a visible decision rather than drift.
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
 * Lowercased tag > canonical spelling, for snapping a freshly emitted tag onto
 * the taxonomy's existing casing instead of splitting it into a near-duplicate.
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
