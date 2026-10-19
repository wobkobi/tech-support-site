// src/features/business/lib/tax/load.ts
// Server loader shaping ledger, assets, trips, TaxYear rows and settings into TaxYearInput.
// Each table is read once per request (React cache), however many FYs a page computes.

import "server-only";

import { listFinancialYears, type FinancialYear } from "@/features/business/lib/financial-year";
import { gstStatusFromPricing } from "@/features/business/lib/tax/gst-basis";
import { filedClosingAtvByFy } from "@/features/business/lib/tax/snapshot";
import { toTaxFy } from "@/features/business/lib/tax/tax-year";
import type {
  AssetInput,
  GstStatus,
  IrdYearRates,
  KmTierRates,
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

/** The TaxYear fields the loader reads; fyKey, filedAt and snapshot feed the filed ATV carry-forward. */
const TAX_YEAR_SELECT = {
  fyKey: true,
  officeSqm: true,
  houseSqm: true,
  sqmRate: true,
  kmTier1: true,
  kmTier2: true,
  totalVehicleKm: true,
  accRate: true,
  mortgageInterestOrRent: true,
  rates: true,
  filedAt: true,
  snapshot: true,
} satisfies Prisma.TaxYearSelect;

/** One TaxYear row as the loader selects it. */
export type TaxYearRow = Prisma.TaxYearGetPayload<{ select: typeof TAX_YEAR_SELECT }>;

/**
 * One stored asset as the maths reads it; unknown free-text values fall back to purchased, DV, no km.
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
 * The `settings.tax` fields the maths reads, copied so nothing mutates the cached settings.
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
 * IRD's km rates for a fuel type; an unknown fuel reads as petrol.
 * @param ird - One year's IRD rates.
 * @param fuel - settings.tax.vehicleFuel.
 * @returns The Tier 1 and Tier 2 rates.
 */
export function kmRatesFor(ird: IrdYearRates, fuel: VehicleFuel): KmTierRates {
  return ird.km[fuel] ?? ird.km.petrol;
}

/**
 * A year's inputs: the stored TaxYear record, with blank rates filled from IRD's rates for
 * that year and fuel. Unset total km and ACC rate stay null.
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
  const km = kmRatesFor(ird, fuel);
  return {
    officeSqm: stored?.officeSqm ?? null,
    houseSqm: stored?.houseSqm ?? null,
    sqmRate: stored?.sqmRate ?? ird.sqmRate,
    kmTier1: stored?.kmTier1 ?? km.tier1,
    kmTier2: stored?.kmTier2 ?? km.tier2,
    totalVehicleKm: stored?.totalVehicleKm ?? null,
    accRate: stored?.accRate ?? null,
    mortgageInterestOrRent: stored?.mortgageInterestOrRent ?? null,
    rates: stored?.rates ?? null,
  };
}

/**
 * Every row the tax maths reads, once per request, across all years.
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
 * Every stored TaxYear row, from the same once-per-request read the tax inputs use.
 * @returns The TaxYear rows.
 */
export async function loadTaxYearRows(): Promise<TaxYearRow[]> {
  return (await loadTaxRows()).taxYears;
}

/**
 * Everything computeTaxYear needs for one FY, plus its raw TaxYear row from the same read
 * (route handlers get no React cache).
 * @param fy - The FY (from {@link loadAllFys}).
 * @param now - Current instant.
 * @returns The tax-year input and the FY's TaxYear row, or null when none is stored.
 */
export async function loadTaxInputsWithRecord(
  fy: FinancialYear,
  now: Date,
): Promise<{ input: TaxYearInput; record: TaxYearRow | null }> {
  const [settings, rows] = await Promise.all([getSettings(), loadTaxRows()]);
  const { income, expenses, assets, trips, taxYears } = rows;
  const taxFy = toTaxFy(fy);
  const record = taxYears.find((t) => t.fyKey === taxFy.key) ?? null;
  // Filed years carry their saved closing values into the next year's opening values.
  const filedClosingAtv = filedClosingAtvByFy(taxYears);
  const input: TaxYearInput = {
    fy: taxFy,
    businessStart: new Date(settings.identity.startDateIso),
    income,
    expenses,
    assets,
    trips,
    year: yearRecordFor(taxFy.key, record ?? undefined, settings.tax.vehicleFuel),
    settings: taxRulesFrom(settings.tax),
    gst: gstStatusFromPricing(settings.pricing),
    filedClosingAtv,
    now,
  };
  return { input, record };
}

/**
 * Everything computeTaxYear needs for one FY.
 * @param fy - The FY (from {@link loadAllFys}).
 * @param now - Current instant.
 * @returns The tax-year input.
 */
export async function loadTaxInputs(fy: FinancialYear, now: Date): Promise<TaxYearInput> {
  return (await loadTaxInputsWithRecord(fy, now)).input;
}

/**
 * Every FY from the business start through the current one, via {@link listFinancialYears}.
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
