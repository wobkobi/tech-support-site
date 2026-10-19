// src/features/business/lib/event-merge.ts
// Suggests other calendar events to bill alongside the current one. Nothing merges unticked,
// and gaps between merged events are never billed.

import { MERGE_SUGGEST_GAP_MINS } from "@/features/business/lib/pricing-policy";
import { NZ_TZ } from "@/shared/lib/timezone-utils";

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
  /** Pre-ticked on a client or address match; a time-only match starts unticked. */
  preselected: boolean;
  /** Operator-facing reason chip, e.g. "20m gap · same address". */
  reason: string;
}

/** NZ-local YYYY-MM-DD for an ISO timestamp. */
const NZ_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: NZ_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * NZ-local calendar day of an ISO timestamp; the same-day rule means the operator's day, not UTC's.
 * @param iso - ISO timestamp.
 * @returns NZ-local YYYY-MM-DD.
 */
export function nzDayKey(iso: string): string {
  return NZ_DAY.format(new Date(iso));
}

/**
 * Normalises a title or location for comparison (case, punctuation, whitespace), since
 * entries drift ("Jane Smith" vs "Jane  Smith -").
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
 * Minutes from the earlier event's end to the later one's start; an overlap gives 0 so it
 * stays offerable.
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
 * Finds same-NZ-day events within `gapLimitMins` of an anchor or anything chained onto one,
 * so each hop only clears its neighbour. Anchors excluded; a zero limit disables it.
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
  if (!earliest) return [];
  const day = nzDayKey(earliest.start);
  // Match ANY anchor: a merged run can span two titles for one customer.
  const anchorClients = new Set(anchors.map((a) => comparisonKey(a.summary)).filter(Boolean));
  const anchorAddresses = new Set(anchors.map((a) => comparisonKey(a.location)).filter(Boolean));

  const sameDay = all
    .filter((e) => !anchorIds.has(e.id) && nzDayKey(e.start) === day)
    .sort((a, b) => a.start.localeCompare(b.start));

  // Grow the chain until a pass adds nothing; each joiner becomes a stepping stone.
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
