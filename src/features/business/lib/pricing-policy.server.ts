// src/features/business/lib/pricing-policy.server.ts
/**
 * @file pricing-policy.server.ts
 * @description Server-only helpers that need Prisma access. Kept separate from
 * pricing-policy.ts so the client-safe module stays importable everywhere
 * without dragging Prisma into the browser bundle.
 */

import "server-only";
import { prisma } from "@/shared/lib/prisma";
import { PUBLIC_HOLIDAY_UPLIFT } from "@/features/business/lib/pricing-policy";

/** One labour modifier as rendered on the pricing page accordion. */
export interface PublicModifier {
  label: string;
  /** Effective $/hr after applying the modifier to the Standard base rate. */
  effectiveRate: number;
  /** Customer-facing delta description (e.g. "+$20", "-$10", "+25%"). */
  deltaDescription: string;
  /** Brief context line shown beneath the rate (e.g. "data recovery, hardware repair"). */
  description: string;
}

/** Shape consumed by the pricing page. Built from the live RateConfig rows. */
export interface PublicPricing {
  /** Standard hourly rate (`isDefault: true` row, or first hourly row as fallback). */
  baseRate: number;
  /** Standard rate + Complex modifier delta. */
  complexRate: number;
  /** Travel hourly rate, used for round-trip drive billing. */
  travelRatePerHour: number;
  /** Customer-facing modifier list rendered in the Modifiers accordion. */
  modifiers: PublicModifier[];
  /** Most-recent updatedAt across all RateConfig rows; powers the "rates last updated" footer. */
  ratesUpdatedAt: Date | null;
}

/** Per-label description shown under each modifier on the accordion. */
const MODIFIER_DESCRIPTIONS: Record<string, string> = {
  Complex: "Data recovery, hardware repair, PC builds, full system migrations.",
  Remote: "Screen-share session - I log in instead of visiting.",
  "At home": "Residential discount available on request.",
  "Public Holiday": "Applied automatically on NZ public holidays.",
};

/**
 * Returns the public-facing pricing snapshot used by the pricing page.
 * Reads RateConfig directly (no self-fetch via /api/pricing/rates) so the
 * page renders in one Prisma round-trip during the server render.
 *
 * Falls back to the hardcoded $65 / $40 defaults when a row is missing so
 * the page never renders blank prices even mid-migration.
 * @returns Live pricing snapshot.
 */
export async function getPublicPricing(): Promise<PublicPricing> {
  const rows = await prisma.rateConfig.findMany({ orderBy: { label: "asc" } });

  const baseRate =
    rows.find((r) => r.ratePerHour !== null && r.isDefault)?.ratePerHour ??
    rows.find((r) => r.ratePerHour !== null && r.unit === "hour")?.ratePerHour ??
    65;

  const complexDelta = rows.find((r) => r.label === "Complex")?.hourlyDelta ?? 0;
  const complexRate = Math.round((baseRate + complexDelta) * 100) / 100;

  const travelRatePerHour =
    rows.find((r) => r.unit === "travel-hour" && r.ratePerHour !== null)?.ratePerHour ?? 40;

  // Modifiers list mirrors the rate-config rows but enriched with a customer-
  // friendly description and effective $/hr. Public Holiday is rendered as a
  // percentage uplift since the schema field is percentDelta, not hourlyDelta.
  const modifiers: PublicModifier[] = [];
  for (const row of rows) {
    if (row.unit !== "modifier") continue;
    if (row.label === "Complex" && row.hourlyDelta !== null) {
      modifiers.push({
        label: row.label,
        effectiveRate: Math.round((baseRate + row.hourlyDelta) * 100) / 100,
        deltaDescription: row.hourlyDelta > 0 ? `+$${row.hourlyDelta}` : `-$${-row.hourlyDelta}`,
        description: MODIFIER_DESCRIPTIONS[row.label] ?? "",
      });
    } else if ((row.label === "Remote" || row.label === "At home") && row.hourlyDelta !== null) {
      modifiers.push({
        label: row.label,
        effectiveRate: Math.round((baseRate + row.hourlyDelta) * 100) / 100,
        deltaDescription: row.hourlyDelta > 0 ? `+$${row.hourlyDelta}` : `-$${-row.hourlyDelta}`,
        description: MODIFIER_DESCRIPTIONS[row.label] ?? "",
      });
    } else if (row.label === "Public Holiday" && row.percentDelta !== null) {
      const pct = Math.round((row.percentDelta ?? PUBLIC_HOLIDAY_UPLIFT) * 100);
      modifiers.push({
        label: row.label,
        effectiveRate:
          Math.round(baseRate * (1 + (row.percentDelta ?? PUBLIC_HOLIDAY_UPLIFT)) * 100) / 100,
        deltaDescription: `+${pct}%`,
        description: MODIFIER_DESCRIPTIONS[row.label] ?? "",
      });
    }
  }

  // Latest mtime across all RateConfig rows. Powers "Rates last updated on
  // {date}" so a customer can't claim the page showed an older figure.
  const ratesUpdatedAt = rows.reduce<Date | null>((max, r) => {
    const t = r.updatedAt;
    if (!t) return max;
    if (!max) return t;
    return t > max ? t : max;
  }, null);

  return {
    baseRate,
    complexRate,
    travelRatePerHour,
    modifiers,
    ratesUpdatedAt,
  };
}
