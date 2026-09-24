"use client";
// Before/after rate table for the promo form. Prices through the same promo
// helpers the pricing page and the invoice engine use, so what the operator
// previews is what customers are charged.

import { formatNZD } from "@/features/business/lib/business";
import {
  describeRecurringWindow,
  promoDisplayRate,
  promoForSpend,
  promoModifierRate,
  promoTravelFactor,
  type ActivePromo,
} from "@/features/business/lib/promos";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/** The live rates a promo preview prices against. Plain data for the server > client boundary. */
export interface PromoPreviewRates {
  /** The Standard hourly rate. */
  baseRate: number;
  /** Base plus the Business modifier; promos never touch it. */
  businessRate: number;
  /** Hourly drive rate for travel. */
  travelRatePerHour: number;
  /** Floor for a visit's travel charge. */
  minTravelCharge: number;
  /** Customer-facing modifiers with their pre-promo rates. */
  modifiers: { label: string; kind: "delta" | "uplift"; effectiveRate: number }[];
}

/** One priced column: a heading and the promo it prices with (null = no discount earned). */
interface Scenario {
  heading: string;
  promo: ActivePromo | null;
}

/** One table row: a label, the current figure, and each scenario's figure. */
interface PriceRow {
  label: string;
  now: number;
  suffix: string;
  /** One figure per scenario, in scenario order. */
  after: number[];
  /** Shown instead of prices for a row the promo never discounts. */
  excludedNote?: string;
}

/**
 * The columns to price. A tiered promo gets one per band, judged at each
 * band's floor through promoForSpend, since the rate depends on which band the
 * job reaches and the promo's own amount is ignored.
 * @param promo - The previewed promo.
 * @returns The scenarios to show.
 */
function scenariosFor(promo: ActivePromo): Scenario[] {
  if (promo.tiers.length > 0) {
    return [...promo.tiers]
      .sort((a, b) => a.minSpend - b.minSpend)
      .map((t) => ({
        heading: `Jobs ${formatNZD(t.minSpend)}+`,
        promo: promoForSpend(promo, t.minSpend),
      }));
  }
  if (promo.minSpend != null) {
    return [{ heading: `Jobs ${formatNZD(promo.minSpend)}+`, promo }];
  }
  return [{ heading: "With promo", promo }];
}

/**
 * Live price preview for the promo being edited.
 * @param props - Component props.
 * @param props.promo - The form's promo, built by the same shape the helpers read.
 * @param props.rates - Live rates to price against.
 * @returns The preview table.
 */
export function PromoPricePreview({
  promo,
  rates,
}: {
  promo: ActivePromo;
  rates: PromoPreviewRates;
}): React.ReactElement {
  const scenarios = scenariosFor(promo);
  const promos = scenarios.map((s) => s.promo);
  const rows: PriceRow[] = [
    {
      label: "Hourly rate",
      now: rates.baseRate,
      suffix: "/hr",
      after: promos.map((p) => promoDisplayRate(rates.baseRate, p)),
    },
    ...rates.modifiers.map<PriceRow>((mod) => ({
      label: mod.label,
      now: mod.effectiveRate,
      suffix: "/hr",
      after: promos.map((p) => promoModifierRate(rates.baseRate, mod.effectiveRate, mod.kind, p)),
    })),
    {
      label: "Business",
      now: rates.businessRate,
      suffix: "/hr",
      after: promos.map(() => rates.businessRate),
      excludedNote: "Never discounted",
    },
    {
      label: "Travel",
      now: rates.travelRatePerHour,
      suffix: "/hr",
      after: promos.map(
        (p) => Math.round(rates.travelRatePerHour * promoTravelFactor(p) * 100) / 100,
      ),
    },
    {
      label: "Minimum travel",
      now: rates.minTravelCharge,
      suffix: "",
      after: promos.map(
        (p) => Math.round(rates.minTravelCharge * promoTravelFactor(p) * 100) / 100,
      ),
    },
  ];

  const notes: string[] = [];
  if (promo.discountType === "fixed_amount") {
    notes.push(
      "A $ off promo comes off the job total once. The hourly figures show a one-hour job, the way the pricing page does.",
    );
  }
  if (promo.tiers.length > 0) {
    notes.push("Jobs below the lowest band get no discount.");
  } else if (promo.minSpend != null) {
    notes.push(
      `Jobs under ${formatNZD(promo.minSpend)} before the discount pay the current rates.`,
    );
  }
  const window = describeRecurringWindow(promo);
  if (window) notes.push(`Only ${window}; other appointments pay the current rates.`);
  if (promo.kind === "code") notes.push("Only for customers who enter the code.");

  return (
    <div className="rounded-xl border border-admin-border bg-admin-bg px-4 py-3">
      <p className="text-xs font-medium text-admin-muted">Prices with this promo</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-admin-muted">
              <th className="py-1 pr-3 font-medium">Rate</th>
              <th className="py-1 pr-3 font-medium">Now</th>
              {scenarios.map((s) => (
                <th key={s.heading} className="py-1 pr-3 font-medium">
                  {s.heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-admin-border">
                <td className="py-1.5 pr-3 text-admin-text">{row.label}</td>
                <td className="py-1.5 pr-3 text-admin-muted tabular-nums">
                  {formatNZD(row.now)}
                  {row.suffix}
                </td>
                {scenarios.map((s, i) => {
                  if (row.excludedNote) {
                    return (
                      <td key={s.heading} className="py-1.5 pr-3 text-admin-faint">
                        {row.excludedNote}
                      </td>
                    );
                  }
                  const after = row.after[i] ?? row.now;
                  const changed = after !== row.now;
                  return (
                    <td
                      key={s.heading}
                      className={cn(
                        "py-1.5 pr-3 tabular-nums",
                        changed ? "font-semibold text-admin-text" : "text-admin-faint",
                      )}
                    >
                      {formatNZD(after)}
                      {row.suffix}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {notes.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-admin-faint">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
