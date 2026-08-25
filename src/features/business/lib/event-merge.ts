// src/features/business/lib/event-merge.ts
// Decides which other calendar events the calculator offers to bill alongside
// the one being billed. Suggestion only - nothing merges without the operator
// ticking it, and the gap between merged events is never billed (each event
// lands as its own time slot, and the slot sum ignores what sits between them).

import { MERGE_SUGGEST_GAP_MINS } from "@/features/business/lib/pricing-policy";

/** Minimal calendar event shape the merge scan needs. */
export interface MergeCandidateEvent {
  id: string;
  summary: string;
  /** ISO start. */
  start: string;
  /** ISO end. */
  end: string;
  location: string | null;
}

/** Why an event is being offered, and whether it starts ticked. */
export interface MergeSuggestion {
  event: MergeCandidateEvent;
  /** Minutes between this event and the nearest already-selected one. */
  gapMins: number;
  /** Same client name as the anchor event. */
  sameClient: boolean;
  /** Same job address as the anchor event. */
  sameAddress: boolean;
  /**
   * Pre-ticked in the picker. Client or address match is strong enough to
   * assume one job; a bare time-proximity match is offered unticked so two
   * unrelated customers can never merge by a stray Enter.
   */
  preselected: boolean;
  /** Operator-facing reason chip, e.g. "20m gap · same address". */
  reason: string;
}

/** NZ-local YYYY-MM-DD for an ISO timestamp. */
const NZ_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Pacific/Auckland",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * NZ-local calendar day of an ISO timestamp. The gap rule is same-day, and
 * "same day" has to mean the operator's day, not UTC's - a 9pm job is still
 * the same NZ day as a 10am one but a different UTC day for half the year.
 * @param iso - ISO timestamp.
 * @returns NZ-local YYYY-MM-DD.
 */
export function nzDayKey(iso: string): string {
  return NZ_DAY.format(new Date(iso));
}

/**
 * Normalises an event title or location for comparison: case-folded, with
 * punctuation and repeated whitespace flattened. Calendar entries for the same
 * client drift ("Jane Smith" vs "Jane  Smith -"), and a literal compare would
 * miss the match that matters most.
 * @param value - Raw title or location, possibly null.
 * @returns Comparison key; empty string when there is nothing to compare.
 */
function comparisonKey(value: string | null): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Minutes between two events, measured from the earlier one's end to the later
 * one's start. Overlapping events give 0, not a negative gap - an overlap is a
 * calendar mistake, and treating it as "no gap" keeps it offerable rather than
 * silently dropping it below the threshold test.
 * @param a - One event.
 * @param b - The other event.
 * @returns Whole minutes of gap, floored at 0.
 */
export function gapMinutes(a: MergeCandidateEvent, b: MergeCandidateEvent): number {
  const [first, second] = a.start <= b.start ? [a, b] : [b, a];
  const ms = new Date(second.start).getTime() - new Date(first.end).getTime();
  return Math.max(0, Math.round(ms / 60000));
}

/**
 * Formats the reason chip shown beside a suggested event.
 * @param gapMins - Gap to the nearest selected event.
 * @param sameClient - Whether the client name matches.
 * @param sameAddress - Whether the address matches.
 * @returns Chip text, e.g. "20m gap · same client".
 */
function describe(gapMins: number, sameClient: boolean, sameAddress: boolean): string {
  const hours = Math.floor(gapMins / 60);
  const mins = gapMins % 60;
  const gap =
    gapMins === 0
      ? "back to back"
      : hours === 0
        ? `${mins}m gap`
        : mins === 0
          ? `${hours}h gap`
          : `${hours}h ${mins}m gap`;
  const matches: string[] = [];
  if (sameClient) matches.push("same client");
  if (sameAddress) matches.push("same address");
  return matches.length > 0 ? `${gap} · ${matches.join(", ")}` : `${gap} · different client`;
}

/**
 * Finds the events worth offering alongside the ones already being billed:
 * same NZ day, and within `gapLimitMins` of an anchor or of anything already
 * chained onto one. The chaining is what lets three or four short visits in an
 * afternoon come through as one suggestion - each hop only has to clear the
 * threshold against its neighbour, not against the first event of the day.
 *
 * Candidates are returned in start order with the anchors excluded. A zero
 * `gapLimitMins` disables suggestions entirely.
 * @param anchors - The events already being billed (at least one).
 * @param all - Every recent event available to the picker.
 * @param gapLimitMins - Largest offerable gap; defaults to the code fallback.
 * @returns Suggestions in start order; empty when nothing qualifies.
 */
export function findMergeSuggestions(
  anchors: MergeCandidateEvent[],
  all: MergeCandidateEvent[],
  gapLimitMins: number = MERGE_SUGGEST_GAP_MINS,
): MergeSuggestion[] {
  if (gapLimitMins <= 0 || anchors.length === 0) return [];
  const anchorIds = new Set(anchors.map((a) => a.id));
  const earliest = [...anchors].sort((a, b) => a.start.localeCompare(b.start))[0];
  const day = nzDayKey(earliest.start);
  // Match against ANY anchor: a merged run can span two calendar titles for
  // the same customer, and either one is evidence for the next hop.
  const anchorClients = new Set(anchors.map((a) => comparisonKey(a.summary)).filter(Boolean));
  const anchorAddresses = new Set(anchors.map((a) => comparisonKey(a.location)).filter(Boolean));

  const sameDay = all
    .filter((e) => !anchorIds.has(e.id) && nzDayKey(e.start) === day)
    .sort((a, b) => a.start.localeCompare(b.start));

  // Grow the chain outward from the anchors: an event joins when it is within
  // the threshold of any event already in the chain, then becomes a stepping
  // stone for the next one. Repeats until a pass adds nothing.
  const chain: MergeCandidateEvent[] = [...anchors];
  const gaps = new Map<string, number>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const candidate of sameDay) {
      if (gaps.has(candidate.id)) continue;
      const nearest = Math.min(...chain.map((c) => gapMinutes(c, candidate)));
      if (nearest <= gapLimitMins) {
        gaps.set(candidate.id, nearest);
        chain.push(candidate);
        grew = true;
      }
    }
  }

  return sameDay
    .filter((e) => gaps.has(e.id))
    .map((event) => {
      const gapMins = gaps.get(event.id) ?? 0;
      const sameClient = anchorClients.has(comparisonKey(event.summary));
      const sameAddress = anchorAddresses.has(comparisonKey(event.location));
      return {
        event,
        gapMins,
        sameClient,
        sameAddress,
        preselected: sameClient || sameAddress,
        reason: describe(gapMins, sameClient, sameAddress),
      };
    });
}
