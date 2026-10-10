// src/features/business/lib/tax/depreciation.ts
// Per-asset depreciation schedule across financial years (IR260): diminishing value or
// straight line, part-year months, the low-value write-off (threshold from settings),
// Investment Boost, private-use split, and disposal recovery or loss. Pure; computed
// fresh every time except where a filed year's snapshot pins the opening value.

import { APRIL } from "@/features/business/lib/financial-year";
import { ledgerDay, pctFraction, roundCents } from "@/features/business/lib/tax/helpers";
import type {
  AssetInput,
  AssetScheduleContext,
  AssetYearRow,
  TaxFy,
} from "@/features/business/lib/tax/types";

/** Investment Boost share of cost deducted in year one (TIB 37/7). */
const INVESTMENT_BOOST_RATE = 0.2;

/** Investment Boost covers assets first used on or after 22 May 2025 (ledger scale). */
export const INVESTMENT_BOOST_FROM = new Date(Date.UTC(2025, 4, 22));

/**
 * One asset's filed closing values out of the all-assets map, so the tax maths and the
 * Assets page pin the same opening values.
 * @param assetId - Asset id.
 * @param filed - Closing ATV by FY key then asset id, from filed TaxYear snapshots.
 * @returns Closing ATV by FY key for this asset (empty when no filed year lists it).
 */
export function filedAtvFor(
  assetId: string,
  filed: ReadonlyMap<string, ReadonlyMap<string, number>>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [fyKey, byAsset] of filed) {
    const atv = byAsset.get(assetId);
    if (atv !== undefined) out.set(fyKey, atv);
  }
  return out;
}

/**
 * The NZ day an asset starts depreciating: its in-service date, but never before
 * the business started (nothing is claimable before then).
 * @param asset - The asset.
 * @param businessStart - Business start date.
 * @returns Ledger-scale start day.
 */
export function assetStartDay(asset: AssetInput, businessStart: Date): Date {
  const inService = ledgerDay(asset.inServiceDate);
  const started = ledgerDay(businessStart);
  return inService.getTime() < started.getTime() ? started : inService;
}

/**
 * Combined cost of each asset's low-value group, keyed by asset id. Purchased
 * items in the same asset class bought from the same supplier on the same NZ day
 * are tested against the threshold together (s EE 38), whatever method or rate
 * each was set to. Introduced assets, km-rate vehicles and purchases with no
 * supplier recorded each stand alone: introduced items are never written off
 * here (accountant check), and a blank supplier can't evidence a shared purchase.
 * @param assets - Every asset on the register.
 * @returns Map of asset id to its group's total cost.
 */
export function lowValueGroupTotals(assets: readonly AssetInput[]): Map<string, number> {
  const groupKeyById = new Map<string, string>();
  const groupSum = new Map<string, number>();
  for (const asset of assets) {
    const supplier = asset.supplier?.trim().toLowerCase() ?? "";
    if (asset.origin !== "purchased" || asset.vehicleMethod === "km" || supplier === "") {
      continue;
    }
    const day = ledgerDay(asset.inServiceDate).toISOString().slice(0, 10);
    const key = `${supplier}|${day}|${asset.classKey}`;
    groupKeyById.set(asset.id, key);
    groupSum.set(key, (groupSum.get(key) ?? 0) + asset.costBase);
  }
  const totals = new Map<string, number>();
  for (const asset of assets) {
    const key = groupKeyById.get(asset.id);
    const sum = key === undefined ? undefined : groupSum.get(key);
    totals.set(asset.id, roundCents(sum ?? asset.costBase));
  }
  return totals;
}

/**
 * Whole months in use during the asset's first FY, counting the start month as
 * a full month (IR260: a part month counts as a month). Clamped to 0-12.
 * @param start - Ledger-scale start day.
 * @param fy - The FY the asset starts in.
 * @returns Months from the start month to March inclusive.
 */
function firstYearMonths(start: Date, fy: TaxFy): number {
  const monthsBefore =
    (start.getUTCFullYear() - fy.start.getUTCFullYear()) * 12 + start.getUTCMonth() - APRIL;
  return Math.min(12, Math.max(0, 12 - monthsBefore));
}

/**
 * Depreciation schedule for one asset: a row per FY in `fys` from the FY the
 * asset starts in, stopping after the FY it is disposed in. `fys` must include
 * every FY from that first one, as each opening value is the previous closing
 * value (or the filed snapshot's, when the year before was filed).
 *
 * Rules per FY:
 * - Disposal FY: no depreciation. Sale above ATV is recovery income, capped at
 *   the depreciation claimed to date (cost less opening ATV); sale below ATV is a
 *   deductible loss. Both are business share. Km-rate vehicles have neither.
 * - First FY of a purchased asset whose group total is within the low-value
 *   threshold: written off in full.
 * - First FY with Investment Boost (purchased, first used from 22 May 2025): 20%
 *   of cost, plus normal depreciation on the remaining 80%. SL then works from
 *   that 80% for life.
 * - Otherwise DV: opening ATV x rate; SL: base x rate, capped at the opening ATV.
 *   The first FY scales by months in use / 12.
 * - The ATV drops by the full depreciation; only the business share is deductible.
 * - Km-rate vehicles: never depreciated; the ATV stays at cost.
 * @param asset - The asset.
 * @param fys - Financial years to schedule, any order.
 * @param ctx - Business start, threshold, group total and filed closing values.
 * @returns One row per FY the asset is on the register, oldest first.
 */
export function assetSchedule(
  asset: AssetInput,
  fys: readonly TaxFy[],
  ctx: AssetScheduleContext,
): AssetYearRow[] {
  const start = assetStartDay(asset, ctx.businessStart);
  const disposedDay = asset.disposedAt ? ledgerDay(asset.disposedAt) : null;
  const businessShare = pctFraction(asset.businessUsePct);
  const isKmVehicle = asset.vehicleMethod === "km";
  const writeOff =
    !isKmVehicle && asset.origin === "purchased" && ctx.groupTotal <= ctx.lowValueThreshold;
  const boostEligible =
    !isKmVehicle &&
    !writeOff &&
    asset.investmentBoost &&
    asset.origin === "purchased" &&
    ledgerDay(asset.inServiceDate).getTime() >= INVESTMENT_BOOST_FROM.getTime();
  const ordered = [...fys].sort((a, b) => a.start.getTime() - b.start.getTime());

  const rows: AssetYearRow[] = [];
  let carriedAtv = asset.costBase;
  let slBase = asset.costBase;
  let prevKey: string | null = null;
  let first = true;
  for (const fy of ordered) {
    if (start.getTime() >= fy.end.getTime()) {
      prevKey = fy.key;
      continue;
    }
    const filed = prevKey === null ? undefined : ctx.filedClosingAtv.get(prevKey);
    const opening = roundCents(filed ?? carriedAtv);
    // Rows stop after the disposal FY, so the first FY ending after the disposal
    // date is that FY. A disposal dated before the start day lands in the first row.
    const disposedHere = disposedDay !== null && disposedDay.getTime() < fy.end.getTime();
    const months = disposedHere ? 0 : first ? firstYearMonths(start, fy) : 12;

    let depreciation = 0;
    let boost = 0;
    let writtenOff = false;
    if (!disposedHere && !isKmVehicle && opening > 0) {
      if (first && writeOff) {
        depreciation = opening;
        writtenOff = true;
      } else {
        if (first && boostEligible) {
          boost = roundCents(asset.costBase * INVESTMENT_BOOST_RATE);
          slBase = asset.costBase - boost;
        }
        const base = opening - boost;
        const annual = asset.method === "SL" ? slBase * asset.rate : base * asset.rate;
        const normal = Math.min(base, (annual * months) / 12);
        depreciation = roundCents(boost + normal);
      }
    }

    let recoveryIncome = 0;
    let lossOnDisposal = 0;
    if (disposedHere && !isKmVehicle) {
      const sale = asset.disposalAmount ?? 0;
      const claimedToDate = Math.max(0, asset.costBase - opening);
      if (sale > opening) {
        recoveryIncome = roundCents(Math.min(sale - opening, claimedToDate) * businessShare);
      } else if (sale < opening) {
        lossOnDisposal = roundCents((opening - sale) * businessShare);
      }
    }

    const closingAtv = disposedHere ? 0 : roundCents(Math.max(0, opening - depreciation));
    rows.push({
      assetId: asset.id,
      fyKey: fy.key,
      months,
      openingAtv: opening,
      depreciation,
      investmentBoost: boost,
      writtenOff,
      deductible: roundCents(depreciation * businessShare),
      closingAtv,
      recoveryIncome,
      lossOnDisposal,
      disposed: disposedHere,
    });
    if (disposedHere) break;
    carriedAtv = closingAtv;
    prevKey = fy.key;
    first = false;
  }
  return rows;
}
