// src/features/booking/lib/owner-quote.ts
// Prices a booking's AI tasks the way the calculator bills them (promo rate, date surcharge,
// travel), so the owner's booking email shows the total the invoice would land on.

import {
  calcJobTotal,
  effectiveHourlyRate,
  taskLineTotals,
} from "@/features/business/lib/business";
import { meetingModifiers } from "@/features/business/lib/estimate-range";
import { calcTravelCharge, type DateSurcharge } from "@/features/business/lib/pricing-policy";
import type { ActivePromo } from "@/features/business/lib/promos";
import { enforceMinBillable } from "@/features/business/lib/task-timing";
import type { RateConfig, TaskLine, TravelEntry } from "@/features/business/types/business";
import { roundCents } from "@/shared/lib/money";

/** One AI task priced for the owner's email. */
export interface OwnerQuoteTask {
  label: string;
  /** Billed minutes, after the minimum-billable floor. */
  mins: number;
  /** Line amount at the breakdown's shown rate (the promo rate when there is one). */
  amount: number;
}

/** A booking's quote priced as the calculator would bill it. */
export interface OwnerQuoteBreakdown {
  /** Hourly rate before any promo: Standard, plus the remote modifier on a remote job. */
  fullRate: number;
  /** The rate the promo bills every line at, or null when there's no such single rate. */
  promoRate: number | null;
  /** The promo pricing the job, or null when none applies. */
  promoTitle: string | null;
  /** Task lines at the promo rate when there is one, else the full rate; empty with no estimate. */
  tasks: OwnerQuoteTask[];
  /** Sum of the task lines. */
  tasksTotal: number;
  /** Weekend, after-hours or holiday surcharge; `amount` is null with no tasks to price. */
  surcharge: { reason: string; perHour: number; amount: number | null } | null;
  /** A promo that comes off as a dollar line (fixed amount, free travel, mixed rates), else 0. */
  promoDiscount: number;
  /** Round-trip travel, or null on a remote job or one with no drive time. */
  travel: { amount: number; minsThere: number; minsBack: number } | null;
  /** All-in estimate, or null with no tasks to price. */
  total: number | null;
  /** The range the customer was shown ("$64 - $121 + $10 travel"), or null when none. */
  quoted: string | null;
}

/**
 * Prices a booking's AI tasks through {@link calcJobTotal}. With no tasks, a one-hour stand-in
 * line still yields the rate pair, and the task, surcharge and total amounts stay empty.
 * @param input - What the booking was priced from.
 * @param input.tasks - The booking's AI tasks; empty when no estimate was run.
 * @param input.rates - Live rate rows.
 * @param input.remote - True for a remote session, which takes the remote modifier.
 * @param input.promo - The promo the job prices with, or null.
 * @param input.surcharge - The slot's date surcharge, or null.
 * @param input.travel - The booked drive (minutes there and back) and its $/hr, or null with none.
 * @param input.pricing - Live pricing settings.
 * @param input.pricing.minBillableMins - Minimum billable labour minutes.
 * @param input.pricing.minTravelCharge - Minimum travel charge in dollars.
 * @param input.pricing.gstRegistered - Whether GST applies.
 * @param input.quoted - The range the customer was shown, or null.
 * @returns The breakdown, or null when there's no Standard rate to price from.
 */
export function priceOwnerQuote(input: {
  tasks: { label: string; mins: number }[];
  rates: RateConfig[];
  remote: boolean;
  promo: ActivePromo | null;
  surcharge: DateSurcharge | null;
  travel: { minsThere: number; minsBack: number; ratePerHour: number } | null;
  pricing: { minBillableMins: number; minTravelCharge: number; gstRegistered: boolean };
  quoted: string | null;
}): OwnerQuoteBreakdown | null {
  const { rates, promo, surcharge, travel, pricing } = input;
  const standard =
    rates.find((r) => r.ratePerHour !== null && r.isDefault) ??
    rates.find((r) => r.ratePerHour !== null);
  if (!standard) return null;
  const modifierIds = input.remote ? meetingModifiers(rates, "remote").map((r) => r.id) : [];
  const fullRate = effectiveHourlyRate(rates, standard.id, modifierIds);

  const estimated = input.tasks.filter((t) => t.mins > 0);
  const priced = estimated.length > 0 ? estimated : [{ label: "Labour", mins: 60 }];
  const lines: TaskLine[] = enforceMinBillable(
    priced.map((t) => ({
      rateConfigId: null,
      baseRateId: standard.id,
      modifierIds,
      description: t.label,
      qty: t.mins / 60,
      unitPrice: fullRate,
      lineTotal: roundCents((t.mins / 60) * fullRate),
      minutes: t.mins,
    })),
    pricing.minBillableMins,
  );

  const travelCost = travel
    ? calcTravelCharge(
        travel.minsThere,
        travel.minsBack,
        travel.ratePerHour,
        pricing.minTravelCharge,
      )
    : 0;
  const travelEntries: TravelEntry[] =
    travel && travelCost > 0
      ? [
          {
            label: "Travel",
            cost: travelCost,
            isAuto: true,
            durationMinsOneWay: travel.minsThere,
            durationMinsBack: travel.minsBack,
          },
        ]
      : [];

  const totals = calcJobTotal(
    {
      durationMins: lines.reduce((s, t) => s + (t.minutes ?? 0), 0),
      tasks: lines,
      parts: [],
      travelEntries,
      notes: "",
      clientName: "",
      clientEmail: "",
    },
    promo,
    {
      gstRegistered: pricing.gstRegistered,
      minTravelCharge: pricing.minTravelCharge,
      minBillableMins: pricing.minBillableMins,
      surchargePerHour: surcharge?.perHour ?? 0,
      standardRate: standard.ratePerHour,
      rates,
    },
  );

  // Promo rate up front: lines at the promo rate, kept only when they sum to what the promo
  // bills. Otherwise the lines stay at the full rate and the promo is its own dollar line.
  const promoRate = totals.promoRate?.after ?? null;
  const promoAmounts =
    promoRate !== null ? taskLineTotals(lines.map((t) => ({ ...t, unitPrice: promoRate }))) : null;
  const promoUpFront =
    promoAmounts !== null &&
    roundCents(promoAmounts.reduce((s, a) => s + a, 0)) ===
      roundCents(totals.tasksTotal - totals.promoDiscount);
  const amounts = promoUpFront ? promoAmounts : taskLineTotals(lines);
  const hasTasks = estimated.length > 0;

  return {
    fullRate,
    promoRate: promoUpFront ? promoRate : null,
    promoTitle: promoRate !== null || totals.promoDiscount > 0 ? (promo?.title ?? null) : null,
    tasks: hasTasks
      ? lines.map((t, i) => ({
          label: t.description,
          mins: t.minutes ?? Math.round(t.qty * 60),
          amount: amounts[i]!,
        }))
      : [],
    tasksTotal: hasTasks ? roundCents(amounts.reduce((s, a) => s + a, 0)) : 0,
    surcharge: surcharge
      ? {
          reason: surcharge.reason,
          perHour: surcharge.perHour,
          amount: hasTasks ? totals.surchargeTotal : null,
        }
      : null,
    promoDiscount: hasTasks && !promoUpFront ? totals.promoDiscount : 0,
    travel:
      travel && travelCost > 0
        ? { amount: totals.travelTotal, minsThere: travel.minsThere, minsBack: travel.minsBack }
        : null,
    total: hasTasks ? totals.total : null,
    quoted: input.quoted,
  };
}
