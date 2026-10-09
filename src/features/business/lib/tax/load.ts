// src/features/business/lib/tax/load.ts
// Server loader for the tax maths: reads every ledger row, the asset register, the km log,
// the per-FY TaxYear records and the live settings, and shapes them into the TaxYearInput
// computeTaxYear takes. Each table is read once per request (React cache), however many
// FYs a page computes.

import "server-only";

import { listFinancialYears, type FinancialYear } from "@/features/business/lib/financial-year";
import { gstStatusFromPricing } from "@/features/business/lib/tax/gst-basis";
import { toTaxFy } from "@/features/business/lib/tax/tax-year";
import type {
  AssetInput,
  GstStatus,
  LedgerExpense,
  LedgerIncome,
  LedgerTrip,
  TaxRulesSettings,
  TaxYearInput,
  TaxYearRecordInput,
  VehicleFuel,
} from "@/features/business/lib/tax/types";
import { irdRatesFor } from "@/features/business/lib/tax/year-rates";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import type { TaxSettings } from "@/shared/lib/settings/types";
import type { Asset, Prisma } from "@prisma/client";
import { cache } from "react";

/**
 * The TaxYear fields the loader reads. fyKey, filedAt and snapshot feed the
 * filed-year ATV carry-forward.
 */
const TAX_YEAR_SELECT = {
  fyKey: true,
  officeSqm: true,
  houseSqm: true,
  sqmRate: true,
  kmTier1: true,
  kmTier2: true,
  totalVehicleKm: true,
  mortgageInterestOrRent: true,
  rates: true,
  filedAt: true,
  snapshot: true,
} satisfies Prisma.TaxYearSelect;

/** One TaxYear row as the loader selects it. */
export type TaxYearRow = Prisma.TaxYearGetPayload<{ select: typeof TAX_YEAR_SELECT }>;

/**
 * One stored asset as the maths reads it. Free-text columns are narrowed to their unions,
 * with the safe reading for anything else: "purchased", diminishing value, no km method.
 * @param a - Asset row.
 * @returns The asset input.
 */
export function toAssetInput(a: Asset): AssetInput {
  return {
    id: a.id,
    name: a.name,
    classKey: a.classKey,
    origin: a.origin === "introduced" ? "introduced" : "purchased",
    inServiceDate: a.inServiceDate.toISOString(),
    costBase: a.costBase,
    supplier: a.supplier?.trim() ? a.supplier.trim() : null,
    method: a.method === "SL" ? "SL" : "DV",
    rate: a.rate,
    businessUsePct: a.businessUsePct,
    investmentBoost: a.investmentBoost,
    vehicleMethod: a.vehicleMethod === "km" ? "km" : null,
    disposedAt: a.disposedAt?.toISOString() ?? null,
    disposalAmount: a.disposalAmount,
    expenseId: a.expenseId,
  };
}

/**
 * The `settings.tax` fields the maths reads, copied so nothing downstream can mutate the
 * cached settings object.
 * @param tax - Live tax settings.
 * @returns The rules for computeTaxYear.
 */
export function taxRulesFrom(tax: TaxSettings): TaxRulesSettings {
  return {
    brackets: tax.brackets.map((b) => ({ ...b })),
    ietc: { ...tax.ietc },
    acc: tax.acc,
    kiwiSaver: tax.kiwiSaver,
    lowValueThreshold: tax.lowValueThreshold,
    provisionalThreshold: tax.provisionalThreshold,
    vehicleFuel: tax.vehicleFuel,
    categoryBusinessUse: { ...tax.categoryBusinessUse },
  };
}

/**
 * A year's inputs: what the TaxYear record stores, with any blank rate taken from IRD's
 * published rates for that year (or the latest year before it) and the settings' fuel type.
 * An unset total vehicle km stays null (the km claim then skips the Tier 1 scaling).
 * @param fyKey - FY key, e.g. "2026-27".
 * @param stored - The year's TaxYear row, if one exists.
 * @param fuel - settings.tax.vehicleFuel.
 * @returns The merged year record.
 */
export function yearRecordFor(
  fyKey: string,
  stored: TaxYearRow | undefined,
  fuel: VehicleFuel,
): TaxYearRecordInput {
  const ird = irdRatesFor(fyKey);
  // A stored fuel outside the union (hand-edited document) reads as petrol rather than crash.
  const km = ird.km[fuel] ?? ird.km.petrol;
  return {
    officeSqm: stored?.officeSqm ?? null,
    houseSqm: stored?.houseSqm ?? null,
    sqmRate: stored?.sqmRate ?? ird.sqmRate,
    kmTier1: stored?.kmTier1 ?? km.tier1,
    kmTier2: stored?.kmTier2 ?? km.tier2,
    totalVehicleKm: stored?.totalVehicleKm ?? null,
    mortgageInterestOrRent: stored?.mortgageInterestOrRent ?? null,
    rates: stored?.rates ?? null,
  };
}

/**
 * Closing ATV per asset id from a filed snapshot's `closingAtv` object. Anything that
 * isn't a finite number is skipped, so a malformed snapshot reads as "nothing filed".
 * @param snapshot - TaxYear.snapshot.
 * @returns Asset id > closing ATV.
 */
export function closingAtvFromSnapshot(snapshot: Prisma.JsonValue | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return out;
  const closing = snapshot.closingAtv;
  if (!closing || typeof closing !== "object" || Array.isArray(closing)) return out;
  for (const [assetId, value] of Object.entries(closing)) {
    if (typeof value === "number" && Number.isFinite(value)) out.set(assetId, value);
  }
  return out;
}

/**
 * Closing ATVs from every filed year, keyed by FY then asset id. Unfiled years are left
 * out even when they hold a snapshot: only a filed return fixes the next year's opening.
 * @param taxYears - TaxYear rows.
 * @returns FY key > (asset id > closing ATV).
 */
export function filedClosingAtvFrom(
  taxYears: readonly TaxYearRow[],
): Map<string, ReadonlyMap<string, number>> {
  const out = new Map<string, ReadonlyMap<string, number>>();
  for (const t of taxYears) {
    if (t.filedAt) out.set(t.fyKey, closingAtvFromSnapshot(t.snapshot));
  }
  return out;
}

/**
 * Every row the tax maths reads, once per request. Ledger rows cover all years:
 * computeTaxYear filters to its FY with the half-open ISO window.
 * @returns Income, expenses, assets, trips and TaxYear rows.
 */
const loadTaxRows = cache(
  async (): Promise<{
    income: LedgerIncome[];
    expenses: LedgerExpense[];
    assets: AssetInput[];
    trips: LedgerTrip[];
    taxYears: TaxYearRow[];
  }> => {
    const [income, expenses, assets, trips, taxYears] = await Promise.all([
      prisma.incomeEntry.findMany({
        orderBy: { date: "asc" },
        select: { date: true, amount: true },
      }),
      prisma.expenseEntry.findMany({
        orderBy: { date: "asc" },
        select: {
          id: true,
          date: true,
          category: true,
          amountIncl: true,
          amountExcl: true,
          supplier: true,
          description: true,
        },
      }),
      prisma.asset.findMany({ orderBy: { inServiceDate: "asc" } }),
      prisma.trip.findMany({ orderBy: { date: "asc" }, select: { date: true, km: true } }),
      prisma.taxYear.findMany({ select: TAX_YEAR_SELECT }),
    ]);
    return {
      income: income.map((r) => ({ date: r.date.toISOString(), amount: r.amount })),
      expenses: expenses.map((r) => ({ ...r, date: r.date.toISOString() })),
      assets: assets.map(toAssetInput),
      trips: trips.map((r) => ({ date: r.date.toISOString(), km: r.km })),
      taxYears,
    };
  },
);

/**
 * Everything computeTaxYear needs for one FY.
 * @param fy - The FY (from {@link loadAllFys}).
 * @param now - Current instant.
 * @returns The tax-year input.
 */
export async function loadTaxInputs(fy: FinancialYear, now: Date): Promise<TaxYearInput> {
  const [settings, rows] = await Promise.all([getSettings(), loadTaxRows()]);
  const { income, expenses, assets, trips, taxYears } = rows;
  const taxFy = toTaxFy(fy);
  const filedClosingAtv = filedClosingAtvFrom(taxYears);
  return {
    fy: taxFy,
    businessStart: new Date(settings.identity.startDateIso),
    income,
    expenses,
    assets,
    trips,
    year: yearRecordFor(
      taxFy.key,
      taxYears.find((t) => t.fyKey === taxFy.key),
      settings.tax.vehicleFuel,
    ),
    settings: taxRulesFrom(settings.tax),
    gst: gstStatusFromPricing(settings.pricing),
    filedClosingAtv,
    now,
  };
}

/**
 * Every FY from the business start through the current one, most recent first (the
 * order {@link listFinancialYears} gives and the FY tabs show).
 * @param now - Current instant.
 * @returns The FYs, most recent first.
 */
export async function loadAllFys(now: Date): Promise<FinancialYear[]> {
  const settings = await getSettings();
  return listFinancialYears(now, new Date(settings.identity.startDateIso));
}

/**
 * GST registration from the live pricing settings.
 * @returns Registration status.
 */
export async function loadGstStatus(): Promise<GstStatus> {
  return gstStatusFromPricing((await getSettings()).pricing);
}
