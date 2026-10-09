// src/features/business/components/promo-list-helpers.ts
// Lifecycle status, overlap detection and display phrases for the admin promo list,
// shared by PromosView and its row/card markup.

import type { PromoRow } from "@/app/admin/(shell)/promos/page";
import type { StatusTone } from "@/features/admin/components/ui/StatusPill";
import { formatNZD } from "@/features/business/lib/business";
import { promoTypeOf } from "@/features/business/lib/promo-form";
import { pickWinningPromo } from "@/features/business/lib/promos";

/** Lifecycle bucket a promo sits in right now. */
export type PromoStatus = "active" | "upcoming" | "expired" | "disabled";

/**
 * Lifecycle bucket for a promo right now.
 * @param p - Promo row.
 * @param now - Reference time.
 * @returns Status badge value.
 */
export function getStatus(p: PromoRow, now: Date = new Date()): PromoStatus {
  if (!p.isActive) return "disabled";
  const start = new Date(p.startAt);
  const end = new Date(p.endAt);
  if (now < start) return "upcoming";
  if (now >= end) return "expired";
  return "active";
}

/**
 * StatusPill tone for a promo lifecycle status.
 * @param status - Lifecycle status.
 * @returns The pill tone.
 */
export function statusTone(status: PromoStatus): StatusTone {
  switch (status) {
    case "active":
      return "success";
    case "upcoming":
      return "info";
    case "expired":
      return "neutral";
    case "disabled":
      return "warning";
  }
}

/**
 * Title-cases a status for display.
 * @param status - Lifecycle status.
 * @returns Capitalised label.
 */
export function statusLabel(status: PromoStatus): string {
  return status[0]!.toUpperCase() + status.slice(1);
}

/**
 * True when two promo date ranges overlap (half-open).
 * @param a - First promo.
 * @param b - Second promo.
 * @returns Whether they overlap.
 */
function rangesOverlap(a: PromoRow, b: PromoRow): boolean {
  const aStart = new Date(a.startAt).getTime();
  const aEnd = new Date(a.endAt).getTime();
  const bStart = new Date(b.startAt).getTime();
  const bEnd = new Date(b.endAt).getTime();
  if (aStart >= bEnd || bStart >= aEnd) return false;
  // Sharing a date range is not competing if they run on different days. A
  // Tuesday promo and a Thursday one never meet, and warning about them would
  // train the operator to ignore the warning that matters.
  if (a.activeWeekdays.length > 0 && b.activeWeekdays.length > 0) {
    return a.activeWeekdays.some((d) => b.activeWeekdays.includes(d));
  }
  return true;
}

/**
 * IDs of active promos whose ranges overlap each other.
 *
 * Compared within a kind only. A code promo and an automatic one can share a
 * window without competing - a valid code always wins, and only for whoever
 * entered it - so pairing them would raise a warning about nothing.
 * @param promos - All promos.
 * @returns Set of overlapping IDs.
 */
export function findOverlaps(promos: PromoRow[]): {
  ids: Set<string>;
  winners: Map<string, string>;
} {
  const ids = new Set<string>();
  const winners = new Map<string, string>();
  const active = promos.filter((p) => p.isActive);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]!;
      const b = active[j]!;
      if (a.kind !== b.kind) continue;
      if (!rangesOverlap(a, b)) continue;
      ids.add(a.id);
      ids.add(b.id);
      // Resolved through the shared selector, and on createdAt rather than
      // startAt, so the warning can never name a different winner than the
      // query that actually picks the promo.
      const winner = pickWinningPromo([
        {
          id: a.id,
          priority: a.priority,
          createdAt: new Date(a.createdAt),
        },
        {
          id: b.id,
          priority: b.priority,
          createdAt: new Date(b.createdAt),
        },
      ]);
      if (winner) {
        winners.set(a.id, winner.id);
        winners.set(b.id, winner.id);
      }
    }
  }
  return { ids, winners };
}

/** Redemption totals for one promo, as returned by the stats endpoint. */
export interface PromoStats {
  redemptions: number;
  totalDiscount: number;
  unvaluedRedemptions: number;
  lastRedeemedAt: string | null;
}

/**
 * One-line usage summary for a promo.
 *
 * Reports rows with no recorded value separately rather than counting them as
 * zero: a promo redeemed before value tracking would otherwise read as "$0
 * discounted", which looks like a promo nobody benefited from.
 * @param stats - Totals for this promo, or undefined when it has none.
 * @returns A sentence describing usage.
 */
export function usageNote(stats: PromoStats | undefined): string {
  if (!stats || stats.redemptions === 0) return "Not used yet.";
  const times = `Used ${stats.redemptions} time${stats.redemptions === 1 ? "" : "s"}`;
  if (stats.unvaluedRedemptions === stats.redemptions) {
    return `${times} - discount value not recorded.`;
  }
  const money = formatNZD(stats.totalDiscount);
  if (stats.unvaluedRedemptions > 0) {
    return `${times} - ${money} discounted (${stats.unvaluedRedemptions} before value tracking).`;
  }
  return `${times} - ${money} discounted.`;
}

/**
 * Phrase for a promo caught in an overlap: which promo actually wins, or that
 * this one does. Empty when the promo overlaps nothing.
 * @param promo - The promo being rendered.
 * @param winners - Winning promo id per overlapping promo id.
 * @param all - Every promo, for resolving the winner's title.
 * @returns A sentence, or an empty string when there is no clash.
 */
export function overlapNote(
  promo: PromoRow,
  winners: Map<string, string>,
  all: PromoRow[],
): string {
  const winnerId = winners.get(promo.id);
  if (!winnerId) return "";
  if (winnerId === promo.id) return "Overlaps another promo - this one wins.";
  const winner = all.find((p) => p.id === winnerId);
  return `Overlaps another promo - ${winner ? winner.title : "the other"} wins.`;
}

/**
 * Short operator-facing description of what a promo does, used by both the
 * table and the mobile card so the two cannot drift.
 * @param p - Stored promo row.
 * @returns A phrase like "$60.00/hr" or "Free travel".
 */
export function describeDiscount(p: PromoRow): string {
  switch (promoTypeOf(p)) {
    case "flat":
      return p.flatHourlyRate !== null ? `${formatNZD(p.flatHourlyRate)}/hr` : "-";
    case "percent":
      return p.percentDiscount !== null ? `${Math.round(p.percentDiscount * 100)}% off` : "-";
    case "fixed":
      return p.fixedAmount !== null ? `${formatNZD(p.fixedAmount)} off` : "-";
    case "travel":
      if (p.travelPercent === null) return "-";
      return p.travelPercent === 0
        ? "Free travel"
        : `${Math.round((1 - p.travelPercent) * 100)}% off travel`;
  }
}
