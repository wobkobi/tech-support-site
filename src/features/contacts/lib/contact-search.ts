import type { GoogleContact } from "@/features/business/types/business";

/**
 * Ranks a contact against a single search token. Lower scores rank first.
 * Returns Infinity when no field matches (caller filters those out). Name
 * matches outrank email > company > phone; exact > prefix > substring within
 * each field.
 * @param c - Contact to rank.
 * @param token - Lowercased search token.
 * @returns Numeric score (lower = better match) or Infinity.
 */
export function scoreContactToken(c: GoogleContact, token: string): number {
  const fields: { value: string; weight: number }[] = [
    { value: c.name?.toLowerCase() ?? "", weight: 0 },
    { value: c.email?.toLowerCase() ?? "", weight: 100 },
    { value: c.company?.toLowerCase() ?? "", weight: 200 },
    { value: c.phone?.toLowerCase() ?? "", weight: 300 },
  ];
  let best = Infinity;
  for (const { value, weight } of fields) {
    if (!value) continue;
    if (value === token) best = Math.min(best, weight);
    else if (value.startsWith(token)) best = Math.min(best, weight + 1);
    else if (value.includes(token)) best = Math.min(best, weight + 2);
  }
  return best;
}

/**
 * Token-split + scored filter shared by the contact picker modal and inline
 * autocomplete. Every space-separated token must match SOME field on the
 * contact (name/email/company/phone). Results sort by best total score so
 * exact-name + prefix matches surface first.
 * @param contacts - Full contact list.
 * @param query - Raw search input.
 * @returns Filtered + ranked contacts. With an empty query, returns the full
 * list sorted alphabetically by name/email.
 */
export function filterContacts(contacts: GoogleContact[], query: string): GoogleContact[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return [...contacts].sort((a, b) =>
      (a.name || a.email || "").localeCompare(b.name || b.email || ""),
    );
  }
  const scored: { contact: GoogleContact; score: number }[] = [];
  for (const c of contacts) {
    let total = 0;
    let allMatch = true;
    for (const t of tokens) {
      const s = scoreContactToken(c, t);
      if (s === Infinity) {
        allMatch = false;
        break;
      }
      total += s;
    }
    if (allMatch) scored.push({ contact: c, score: total });
  }
  return scored.sort((a, b) => a.score - b.score).map((s) => s.contact);
}
